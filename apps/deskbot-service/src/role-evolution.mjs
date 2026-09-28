import { createHash } from 'node:crypto';

import { isFantasyEvidenceEvent } from './fantasy-pull.mjs';

const DEFAULT_CHARACTER_ID = 'shaping-001';
const CANDIDATE_NAMESPACE = 'role.evolution-candidates';
const RUN_NAMESPACE = 'role.evolution-runs';
const COOLDOWN_NAMESPACE = 'role.evolution-cooldowns';
const MAX_RUNS = 120;
const MAX_CANDIDATES = 120;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function characterKey(value, fallback = DEFAULT_CHARACTER_ID) {
  return text(value, fallback);
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function candidateKey(characterId, directionId) {
  return `${characterId}:${directionId}`;
}

function proposalIdFor(characterId, directionId) {
  return `role-evolution:${characterId}:${directionId}`;
}

function nextProposalId(roles, characterId, directionId) {
  const base = proposalIdFor(characterId, directionId);
  const history = roles?.list?.({ characterId, limit: 200 }) ?? [];
  if (!history.some((item) => item.direction_id === directionId)) return base;
  let revision = 2;
  while (history.some((item) => item.proposal_id === `${base}-r${revision}`)) revision += 1;
  return `${base}-r${revision}`;
}

function eventIsEligible(event) {
  if (!isFantasyEvidenceEvent(event)) return false;
  const type = typeof event?.type === 'string' ? event.type : '';
  const role = typeof event?.payload?.role === 'string' ? event.payload.role.toLowerCase() : '';
  if (role === 'assistant' || type === 'conversation.reply') return false;
  if (type.startsWith('voice.') || type.startsWith('transport.') || type.startsWith('service.')) return false;
  if (type.startsWith('conversation.output') || type.startsWith('device.output') || type.startsWith('device.lifecycle')) return false;
  if (event?.source === 'role-evolution-engine' || event?.source_kind === 'role_evolution') return false;
  return true;
}

function stableEvents(inputStore, characterId, limit) {
  const events = inputStore?.list?.({ limit }) ?? [];
  return events
    .filter((event) => eventIsEligible(event))
    .filter((event) => event.character_id === characterId || event.character_id === null || event.character_id === undefined)
    .sort((left, right) => String(left.event_id).localeCompare(String(right.event_id)));
}

function activeProposalFor(roles, characterId, directionId) {
  return (roles?.list?.({ characterId, limit: 200 }) ?? [])
    .filter((proposal) => proposal.direction_id === directionId)
    .filter((proposal) => ['proposed', 'deferred', 'trying', 'accepted'].includes(proposal.status))
    .sort((left, right) => String(right.decided_at ?? right.proposed_at).localeCompare(String(left.decided_at ?? left.proposed_at)))[0] ?? null;
}

export function createRoleEvolution({
  now = () => new Date(),
  inputStore,
  roles,
  computeFantasyPull,
  persistence = null,
  worldSnapshot = null,
  activeCharacter = DEFAULT_CHARACTER_ID,
  cooldownMs = 24 * 3600000,
  maxRuns = MAX_RUNS,
} = {}) {
  if (!inputStore || typeof inputStore.list !== 'function') throw new TypeError('role evolution needs inputStore');
  if (!roles || typeof roles.list !== 'function' || typeof roles.propose !== 'function') throw new TypeError('role evolution needs role proposal store');
  if (typeof computeFantasyPull !== 'function') throw new TypeError('role evolution needs computeFantasyPull');

  const candidates = new Map(
    (persistence?.list?.(CANDIDATE_NAMESPACE) ?? []).map((item) => [item.candidate_key, item]),
  );
  const runs = new Map(
    (persistence?.list?.(RUN_NAMESPACE) ?? []).map((item) => [item.run_id, item]),
  );
  const cooldowns = new Map(
    (persistence?.list?.(COOLDOWN_NAMESPACE) ?? []).map((item) => [item.cooldown_key, item]),
  );
  let lastRunId = [...runs.values()].at(-1)?.run_id ?? null;

  function saveCandidate(value) {
    const next = clone(value);
    candidates.set(next.candidate_key, next);
    persistence?.put?.(CANDIDATE_NAMESPACE, next.candidate_key, next);
    while (candidates.size > MAX_CANDIDATES) {
      const oldest = candidates.keys().next().value;
      if (oldest === undefined) break;
      candidates.delete(oldest);
      persistence?.remove?.(CANDIDATE_NAMESPACE, oldest);
    }
    return clone(next);
  }

  function saveRun(value) {
    const next = clone(value);
    runs.set(next.run_id, next);
    persistence?.put?.(RUN_NAMESPACE, next.run_id, next);
    while (runs.size > Math.min(MAX_RUNS, Math.max(1, Number(maxRuns) || MAX_RUNS))) {
      const oldest = runs.keys().next().value;
      if (oldest === undefined) break;
      runs.delete(oldest);
      persistence?.remove?.(RUN_NAMESPACE, oldest);
    }
    lastRunId = next.run_id;
    return clone(next);
  }

  function saveCooldown(value) {
    const next = clone(value);
    cooldowns.set(next.cooldown_key, next);
    persistence?.put?.(COOLDOWN_NAMESPACE, next.cooldown_key, next);
    return clone(next);
  }

  function materializePull(pull, characterId, at) {
    const key = candidateKey(characterId, pull.direction_id);
    const previous = candidates.get(key);
    const evidenceFingerprint = fingerprint([...pull.evidence_ids].sort());
    const existing = activeProposalFor(roles, characterId, pull.direction_id);
    const cooldown = cooldowns.get(key);
    const cooldownUntilMs = cooldown?.cooldown_until ? Date.parse(cooldown.cooldown_until) : 0;
    const nowMs = at.getTime();
    const withinCooldown = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs;
    const record = {
      schema: 'deskbot.role-evolution-candidate.v0.1',
      candidate_key: key,
      character_id: characterId,
      direction_id: pull.direction_id,
      label: pull.label,
      life: pull.life,
      status: pull.status,
      score: pull.score,
      fantasy_pull: pull.fantasy_pull,
      evidence_ids: [...pull.evidence_ids],
      sources: [...(pull.sources ?? [])],
      evidence_fingerprint: evidenceFingerprint,
      first_seen_at: previous?.first_seen_at ?? at.toISOString(),
      last_seen_at: at.toISOString(),
      observation_count: (previous?.observation_count ?? 0) + 1,
      proposal_id: existing?.proposal_id ?? (pull.status === 'candidate' ? nextProposalId(roles, characterId, pull.direction_id) : null),
      proposal_status: existing?.status ?? null,
      cooldown_until: cooldown?.cooldown_until ?? null,
      updated_at: at.toISOString(),
    };

    let proposal = existing;
    let created = false;
    let suppressed = null;
    const evidenceChanged = previous?.evidence_fingerprint !== evidenceFingerprint;
    if (pull.status === 'candidate') {
      if (existing) {
        suppressed = 'existing_active_proposal';
        if (typeof roles.refreshEvidence === 'function') {
          proposal = roles.refreshEvidence(existing.proposal_id, pull, { now: at }) ?? proposal;
        }
      } else if (withinCooldown && !evidenceChanged) {
        suppressed = 'cooldown';
      } else {
        proposal = roles.propose(pull, {
          characterId,
          proposalId: nextProposalId(roles, characterId, pull.direction_id),
          now: at,
          cooldownMs,
        });
        created = Boolean(proposal);
        if (proposal) {
          saveCooldown({
            schema: 'deskbot.role-evolution-cooldown.v0.1',
            cooldown_key: key,
            character_id: characterId,
            direction_id: pull.direction_id,
            proposal_id: proposal.proposal_id,
            cooldown_until: proposal.cooldown_until,
            updated_at: at.toISOString(),
          });
        }
      }
    }
    record.proposal_id = proposal?.proposal_id ?? record.proposal_id;
    record.proposal_status = proposal?.status ?? record.proposal_status;
    saveCandidate(record);
    return { candidate: record, proposal: clone(proposal), created, suppressed };
  }

  function sync({ characterId = activeCharacter, limit = 200 } = {}) {
    const resolvedCharacterId = characterKey(characterId);
    const at = now();
    const events = stableEvents(inputStore, resolvedCharacterId, limit);
    const eventFingerprint = fingerprint(events.map((event) => event.event_id));
    const runId = `role-evolution:${resolvedCharacterId}:${eventFingerprint.slice(0, 24)}`;
    const existingRun = runs.get(runId);
    if (existingRun) {
      lastRunId = existingRun.run_id;
      return clone({ ...existingRun, created: [], duplicate: true });
    }
    const pulls = computeFantasyPull(events, { now: at, maxCandidates: 12 });
    const materialized = pulls.map((pull) => materializePull(pull, resolvedCharacterId, at));
    const run = saveRun({
      schema: 'deskbot.role-evolution-run.v0.1',
      run_id: runId,
      character_id: resolvedCharacterId,
      started_at: at.toISOString(),
      completed_at: at.toISOString(),
      event_count: events.length,
      event_ids: events.map((event) => event.event_id),
      event_fingerprint: eventFingerprint,
      pulls: pulls.map((pull) => ({
        direction_id: pull.direction_id,
        status: pull.status,
        score: pull.score,
        evidence_ids: [...pull.evidence_ids],
        sources: [...(pull.sources ?? [])],
      })),
      materialized: materialized.map((item) => ({
        direction_id: item.candidate.direction_id,
        proposal_id: item.proposal?.proposal_id ?? null,
        proposal_status: item.proposal?.status ?? item.candidate.proposal_status ?? null,
        created: item.created,
        suppressed: item.suppressed,
        evidence_fingerprint: item.candidate.evidence_fingerprint,
      })),
      world_revision: typeof worldSnapshot === 'function' ? worldSnapshot()?.world_revision ?? null : null,
    });
    return clone({
      ...run,
      // Keep a small client-facing projection alongside the auditable run
      // ledger. The ledger retains every pull and suppression reason; callers
      // should not have to reconstruct newly materialized proposals from it.
      created: materialized
        .filter((item) => item.created && item.proposal)
        .map((item) => item.proposal),
      duplicate: false,
    });
  }

  function observeEvent(event) {
    if (!eventIsEligible(event)) return { ignored: true, reason: 'ineligible_event', run: null, trials: [] };
    const characterId = characterKey(event.character_id);
    const trials = [];
    if (typeof roles.activeTrials === 'function' && typeof roles.recordTrialObservation === 'function') {
      for (const trial of roles.activeTrials({ characterId, limit: 20 })) {
        const result = roles.recordTrialObservation(trial.proposal_id, {
          eventId: event.event_id,
          evidenceId: `evidence-${event.event_id}`,
          signal: 'neutral',
        });
        trials.push({
          proposal_id: trial.proposal_id,
          direction_id: trial.direction_id,
          status: result?.trial?.status ?? null,
          turns_observed: result?.trial?.turns_observed ?? null,
        });
      }
    }
    return { ignored: false, reason: null, run: sync({ characterId }), trials };
  }

  function syncAll({ limit = 200 } = {}) {
    const ids = new Set([activeCharacter]);
    for (const event of inputStore.list({ limit })) {
      if (eventIsEligible(event)) ids.add(characterKey(event.character_id));
    }
    return [...ids].map((characterId) => sync({ characterId, limit }));
  }

  function snapshot({ characterId = null, limit = 50 } = {}) {
    const bounded = Math.min(Math.max(Number(limit) || 50, 1), MAX_CANDIDATES);
    const candidateList = [...candidates.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .slice(-bounded)
      .map(clone);
    const runList = [...runs.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .slice(-bounded)
      .map(clone);
    return {
      schema: 'deskbot.role-evolution-snapshot.v0.1',
      active_character_id: activeCharacter,
      character_id: characterId,
      candidates: candidateList,
      cooldowns: [...cooldowns.values()]
        .filter((item) => !characterId || item.character_id === characterId)
        .slice(-bounded)
        .map(clone),
      runs: runList,
      last_run_id: lastRunId,
    };
  }

  return {
    sync,
    syncAll,
    observeEvent,
    snapshot,
    constants: {
      activeCharacter,
      candidateNamespace: CANDIDATE_NAMESPACE,
      runNamespace: RUN_NAMESPACE,
      cooldownNamespace: COOLDOWN_NAMESPACE,
    },
  };
}

export {
  CANDIDATE_NAMESPACE,
  COOLDOWN_NAMESPACE,
  DEFAULT_CHARACTER_ID,
  MAX_CANDIDATES,
  MAX_RUNS,
  RUN_NAMESPACE,
  eventIsEligible,
  proposalIdFor,
};
