import { createHash } from 'node:crypto';
import { localWorldDate } from './realtime-world.mjs';

import { isFantasyEvidenceEvent } from './fantasy-pull.mjs';
import { roleDevelopmentReadModel, candidateDevelopmentContext } from './role-development.mjs';
import { roleWishReadModel } from './role-wishes.mjs';
import { practicalTrialReadModel, practicalTrialsReadModel, PRACTICAL_TRIAL_DIRECTIONS } from './role-practical-trials.mjs';
import { RoleProposalError, roleDirectionOverlay } from './role-proposals.mjs';
import { roleStagePreview, roleStageReadModel, roleStagesReadModel } from './role-stages.mjs';

const DEFAULT_CHARACTER_ID = 'shaping-001';
const EVIDENCE_NAMESPACE = 'role.evidence';
const PULL_NAMESPACE = 'role.pulls';
const CANDIDATE_NAMESPACE = 'role.evolution-candidates';
const RUN_NAMESPACE = 'role.evolution-runs';
const COOLDOWN_NAMESPACE = 'role.evolution-cooldowns';
const MAX_RUNS = 120;
const MAX_CANDIDATES = 120;
const MAX_EVIDENCE = 500;
const MAX_PULLS = 500;
const EVIDENCE_WINDOW_DAYS = 30;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RULE_VERSION = 'role-evolution-rules.v0.8';
const WISH_RULE_VERSION = 'role-wish-lifecycle.v1';

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

function stringIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
    : [];
}

function candidateKey(characterId, directionId) {
  return `${characterId}:${directionId}`;
}

function evidenceKey(characterId, directionId, evidenceId) {
  return `${characterId}:${directionId}:${evidenceId}`;
}

function pullKey(characterId, directionId, fingerprintValue) {
  return `${characterId}:${directionId}:${fingerprintValue}`;
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
  if (event?.source === 'untrusted_observation') return false;
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
    .sort((left, right) => {
      const leftAt = Date.parse(left.received_at ?? left.observed_at ?? left.occurred_at ?? '') || 0;
      const rightAt = Date.parse(right.received_at ?? right.observed_at ?? right.occurred_at ?? '') || 0;
      return leftAt - rightAt || String(left.event_id).localeCompare(String(right.event_id));
    });
}

function logicalDay(value, timeZone = null) {
  if (timeZone) return localWorldDate(value, timeZone)?.date ?? null;
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : null;
}

function evidenceFromPull(pull, events, at, windowDays = EVIDENCE_WINDOW_DAYS, timeZone = null) {
  const eventsById = new Map(events.map((event) => [event.event_id, event]));
  return (Array.isArray(pull.evidence) ? pull.evidence : pull.evidence_ids.map((evidenceId) => ({
    evidence_id: evidenceId,
    event_id: String(evidenceId).replace(/^evidence-/, ''),
    cues: [],
  }))).map((item) => {
    const event = eventsById.get(item.event_id) ?? {};
    const observedAt = event.received_at ?? item.observed_at ?? event.observed_at ?? event.occurred_at ?? at.toISOString();
    const occurredAt = item.occurred_at ?? event.occurred_at ?? observedAt;
    const expiresAt = new Date(Date.parse(observedAt) + windowDays * 24 * 3600000).toISOString();
    return {
      schema: 'deskbot.role-evidence.v0.3',
      rule_version: RULE_VERSION,
      evidence_id: item.evidence_id,
      event_id: item.event_id,
      direction_id: pull.direction_id,
      cues: [...new Set((item.cues ?? []).filter((cue) => typeof cue === 'string' && cue.trim()).map((cue) => cue.trim()))],
      support_cues: [...new Set((item.support_cues ?? item.cues ?? []).filter((cue) => typeof cue === 'string' && cue.trim()).map((cue) => cue.trim()))],
      conflict_cues: [...new Set((item.conflict_cues ?? []).filter((cue) => typeof cue === 'string' && cue.trim()).map((cue) => cue.trim()))],
      neutral_cues: [...new Set((item.neutral_cues ?? []).filter((cue) => typeof cue === 'string' && cue.trim()).map((cue) => cue.trim()))],
      polarity: item.polarity ?? 'support',
      support_weight: item.support_weight ?? (item.polarity === 'conflict' ? 0 : 1),
      conflict_weight: item.conflict_weight ?? (item.polarity === 'conflict' ? 1 : 0),
      source: item.source ?? event.source ?? null,
      source_kind: event.source_kind ?? null,
      source_event_ids: stringIds(
        Array.isArray(item.source_event_ids) ? item.source_event_ids : event.provenance?.source_event_ids,
      ),
      layer: item.layer ?? event.layer ?? null,
      confidence: item.confidence ?? event.confidence ?? 1,
      provenance: structuredClone(event.provenance ?? null),
      observed_at: observedAt,
      occurred_at: occurredAt,
      logical_day: logicalDay(timeZone ? occurredAt : observedAt, timeZone),
      day_basis: timeZone ? 'occurred_at_local_calendar' : 'observed_at_utc_simulation',
      time_zone: timeZone,
      expires_at: expiresAt,
      status: Date.parse(observedAt) + windowDays * 24 * 3600000 > at.getTime() ? 'active' : 'expired',
      fingerprint: fingerprint({
        evidence_id: item.evidence_id,
        event_id: item.event_id,
        direction_id: pull.direction_id,
        day_basis: timeZone,
        logical_day: logicalDay(timeZone ? occurredAt : observedAt, timeZone),
        cues: item.cues ?? [],
        source: item.source ?? event.source ?? null,
        polarity: item.polarity ?? 'support',
        support_cues: item.support_cues ?? item.cues ?? [],
        conflict_cues: item.conflict_cues ?? [],
        neutral_cues: item.neutral_cues ?? [],
      }),
    };
  });
}

function withinEvidenceWindow(event, at, windowDays) {
  const observedMs = Date.parse(event?.received_at ?? event?.observed_at ?? event?.occurred_at ?? '');
  if (!Number.isFinite(observedMs)) return false;
  const ageMs = at.getTime() - observedMs;
  return ageMs >= -MAX_FUTURE_SKEW_MS && ageMs <= windowDays * 24 * 3600000;
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
  evidenceWindowDays = EVIDENCE_WINDOW_DAYS,
  minProposalLogicalDays = 2,
} = {}) {
  if (!inputStore || typeof inputStore.list !== 'function') throw new TypeError('role evolution needs inputStore');
  if (!roles || typeof roles.list !== 'function' || typeof roles.propose !== 'function') throw new TypeError('role evolution needs role proposal store');
  if (typeof computeFantasyPull !== 'function') throw new TypeError('role evolution needs computeFantasyPull');
  if (!Number.isInteger(evidenceWindowDays) || evidenceWindowDays < 1 || evidenceWindowDays > 365) throw new TypeError('evidenceWindowDays must be an integer from 1 to 365');
  if (!Number.isInteger(minProposalLogicalDays) || minProposalLogicalDays < 1 || minProposalLogicalDays > 30) throw new TypeError('minProposalLogicalDays must be an integer from 1 to 30');

  const candidates = new Map(
    (persistence?.list?.(CANDIDATE_NAMESPACE) ?? []).map((item) => [item.candidate_key, item]),
  );
  const runs = new Map(
    (persistence?.list?.(RUN_NAMESPACE) ?? []).map((item) => [item.run_id, item]),
  );
  const cooldowns = new Map(
    (persistence?.list?.(COOLDOWN_NAMESPACE) ?? []).map((item) => [item.cooldown_key, item]),
  );
  const evidence = new Map(
    (persistence?.list?.(EVIDENCE_NAMESPACE) ?? []).map((item) => [
      evidenceKey(item.character_id ?? activeCharacter, item.direction_id, item.evidence_id),
      item,
    ]),
  );
  const pulls = new Map(
    (persistence?.list?.(PULL_NAMESPACE) ?? []).map((item) => [item.pull_key, item]),
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

  function saveEvidence(value) {
    const next = clone(value);
    const key = evidenceKey(next.character_id, next.direction_id, next.evidence_id);
    evidence.set(key, next);
    persistence?.put?.(EVIDENCE_NAMESPACE, key, next);
    while (evidence.size > MAX_EVIDENCE) {
      const oldest = evidence.keys().next().value;
      if (oldest === undefined) break;
      evidence.delete(oldest);
      persistence?.remove?.(EVIDENCE_NAMESPACE, oldest);
    }
    return clone(next);
  }

  function expireEvidence(at, characterId) {
    const nowMs = at.getTime();
    for (const [key, item] of evidence) {
      if (item.character_id !== characterId || item.status === 'expired') continue;
      const expiresMs = Date.parse(item.expires_at ?? '');
      if (!Number.isFinite(expiresMs) || expiresMs > nowMs) continue;
      const expired = { ...item, status: 'expired', expired_at: at.toISOString() };
      evidence.set(key, expired);
      persistence?.put?.(EVIDENCE_NAMESPACE, key, expired);
    }
  }

  function markUnmaterializedCandidatesStale(at, characterId, materializedDirectionIds) {
    for (const candidate of candidates.values()) {
      if (candidate.character_id !== characterId || materializedDirectionIds.has(candidate.direction_id)) continue;
      const supportIds = candidate.support_evidence_ids ?? candidate.evidence_ids ?? [];
      const hasActiveSupport = supportIds.some((evidenceId) => {
        const record = evidence.get(evidenceKey(characterId, candidate.direction_id, evidenceId));
        return record?.status !== 'expired' && withinEvidenceWindow(record, at, evidenceWindowDays);
      });
      saveCandidate({
        ...candidate,
        status: hasActiveSupport ? 'observing' : 'stale',
        stale_reason: hasActiveSupport ? 'below_active_candidate_threshold' : 'support_evidence_expired',
        stale_at: at.toISOString(),
        proposal_gate: {
          ...(candidate.proposal_gate ?? {}),
          eligible: false,
        },
        updated_at: at.toISOString(),
      });
    }
  }

  function savePull(value) {
    const next = clone(value);
    pulls.set(next.pull_key, next);
    persistence?.put?.(PULL_NAMESPACE, next.pull_key, next);
    while (pulls.size > MAX_PULLS) {
      const oldest = pulls.keys().next().value;
      if (oldest === undefined) break;
      pulls.delete(oldest);
      persistence?.remove?.(PULL_NAMESPACE, oldest);
    }
    return clone(next);
  }

  function materializePull(pull, characterId, at, events) {
    const key = candidateKey(characterId, pull.direction_id);
    const previous = candidates.get(key);
    const evidenceFingerprint = fingerprint([...pull.evidence_ids].sort());
    const existing = activeProposalFor(roles, characterId, pull.direction_id);
    const cooldown = cooldowns.get(key);
    const cooldownUntilMs = cooldown?.cooldown_until ? Date.parse(cooldown.cooldown_until) : 0;
    const nowMs = at.getTime();
    const withinCooldown = Number.isFinite(cooldownUntilMs) && cooldownUntilMs > nowMs;
    const evidenceRecords = evidenceFromPull(pull, events, at, evidenceWindowDays, worldSnapshot?.()?.clock?.mode === 'real_time' ? worldSnapshot().clock.time_zone : null);
    for (const record of evidenceRecords) saveEvidence({ ...record, character_id: characterId });
    const supportEvidenceRecords = evidenceRecords.filter((record) => record.support_weight > 0);
    const logicalDays = [...new Set(supportEvidenceRecords.map((record) => record.logical_day).filter(Boolean))];
    const activeTrial = typeof roles.activeTrials === 'function'
      ? roles.activeTrials({ characterId, limit: 50 }).find((trial) => trial.direction_id !== pull.direction_id)
      : null;
    const canAutoPropose = pull.status === 'candidate'
      && logicalDays.length >= minProposalLogicalDays
      && !activeTrial;
    const record = {
      schema: 'deskbot.role-evolution-candidate.v0.3',
      rule_version: RULE_VERSION,
      candidate_key: key,
      character_id: characterId,
      direction_id: pull.direction_id,
      label: pull.label,
      life: pull.life,
      status: pull.status,
      score: pull.score,
      fantasy_pull: pull.fantasy_pull,
      evidence_ids: [...pull.evidence_ids],
      evidence_count: evidenceRecords.length,
      support_evidence_ids: [...(pull.support_evidence_ids ?? pull.evidence_ids)],
      conflict_evidence_ids: [...(pull.conflict_evidence_ids ?? [])],
      support_evidence_count: supportEvidenceRecords.length,
      logical_days: logicalDays,
      first_evidence_at: supportEvidenceRecords[0]?.occurred_at ?? null,
      last_evidence_at: supportEvidenceRecords.at(-1)?.occurred_at ?? null,
      sources: [...(pull.sources ?? [])],
      support_score: pull.support_score ?? pull.score,
      conflict_score: pull.conflict_score ?? 0,
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
    if (pull.status === 'candidate') {
      if (existing) {
        suppressed = 'existing_active_proposal';
        if (typeof roles.refreshEvidence === 'function') {
          proposal = roles.refreshEvidence(existing.proposal_id, pull, { now: at }) ?? proposal;
        }
      } else if (withinCooldown) {
        suppressed = 'cooldown';
      } else if (!canAutoPropose) {
        suppressed = activeTrial ? 'active_trial' : 'cross_logical_day_gate';
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
    record.proposal_gate = {
      required_logical_days: minProposalLogicalDays,
      observed_logical_days: logicalDays.length,
      active_trial: activeTrial?.proposal_id ?? null,
      eligible: canAutoPropose,
    };
    saveCandidate(record);
    return { candidate: record, proposal: clone(proposal), created, suppressed };
  }

  function sync({ characterId = activeCharacter, limit = 200 } = {}) {
    const resolvedCharacterId = characterKey(characterId);
    const at = now();
    if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new TypeError('role evolution now() must return a valid Date');
    const world = typeof worldSnapshot === 'function' ? worldSnapshot() : null;
    // Once canonical facets are installed, words, weather cues and old dialogue
    // trial scores must never bypass the actual-life prerequisite gate.
    if (world?.memory?.development?.facets) return syncWishes(resolvedCharacterId, at, world);
    expireEvidence(at, resolvedCharacterId);
    const events = stableEvents(inputStore, resolvedCharacterId, limit)
      .filter((event) => withinEvidenceWindow(event, at, evidenceWindowDays));
    const eventFingerprint = fingerprint(events.map((event) => event.event_id));
    const timeZone = worldSnapshot?.()?.clock?.mode === 'real_time' ? worldSnapshot().clock.time_zone : null;
    const evaluationDay = logicalDay(at.toISOString(), timeZone);
    const runId = `role-evolution:${resolvedCharacterId}:${RULE_VERSION}:${timeZone ?? 'simulation-utc'}:${evaluationDay}:${eventFingerprint.slice(0, 24)}`;
    const existingRun = runs.get(runId);
    if (existingRun) {
      lastRunId = existingRun.run_id;
      return clone({ ...existingRun, created: [], duplicate: true });
    }
    const pulls = computeFantasyPull(events, { now: at, maxCandidates: 12 });
    const materialized = pulls.map((pull) => {
      const pullEvidence = evidenceFromPull(pull, events, at, evidenceWindowDays, timeZone);
      const pullFingerprint = fingerprint({
        direction_id: pull.direction_id,
        evidence_ids: pull.evidence_ids,
        score: pull.score,
        support_score: pull.support_score ?? pull.score,
        conflict_score: pull.conflict_score ?? 0,
        support_evidence_ids: pull.support_evidence_ids ?? pull.evidence_ids,
        conflict_evidence_ids: pull.conflict_evidence_ids ?? [],
        sources: pull.sources,
      });
      savePull({
        schema: 'deskbot.role-pull.v0.3',
        rule_version: RULE_VERSION,
        pull_key: pullKey(resolvedCharacterId, pull.direction_id, pullFingerprint),
        character_id: resolvedCharacterId,
        direction_id: pull.direction_id,
        status: pull.status,
        score: pull.score,
        support_score: pull.support_score ?? pull.score,
        conflict_score: pull.conflict_score ?? 0,
        fantasy_pull: pull.fantasy_pull,
        evidence_ids: [...pull.evidence_ids],
        support_evidence_ids: [...(pull.support_evidence_ids ?? pull.evidence_ids)],
        conflict_evidence_ids: [...(pull.conflict_evidence_ids ?? [])],
        sources: [...(pull.sources ?? [])],
        logical_days: [...new Set(pullEvidence.map((item) => item.logical_day).filter(Boolean))],
        event_ids: [...new Set(pullEvidence.map((item) => item.event_id).filter(Boolean))],
        observed_at: at.toISOString(),
      });
      return materializePull(pull, resolvedCharacterId, at, events);
    });
    markUnmaterializedCandidatesStale(at, resolvedCharacterId, new Set(pulls.map((pull) => pull.direction_id)));
    const run = saveRun({
      schema: 'deskbot.role-evolution-run.v0.4',
      rule_version: RULE_VERSION,
      run_id: runId,
      character_id: resolvedCharacterId,
      started_at: at.toISOString(),
      completed_at: at.toISOString(),
      event_count: events.length,
      event_ids: events.map((event) => event.event_id),
      result_event_ids: events.map((event) => event.event_id),
      event_fingerprint: eventFingerprint,
      pulls: pulls.map((pull) => ({
        direction_id: pull.direction_id,
        status: pull.status,
        score: pull.score,
        support_score: pull.support_score ?? pull.score,
        conflict_score: pull.conflict_score ?? 0,
        evidence_ids: [...pull.evidence_ids],
        support_evidence_ids: [...(pull.support_evidence_ids ?? pull.evidence_ids)],
        conflict_evidence_ids: [...(pull.conflict_evidence_ids ?? [])],
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
      evidence_count: evidence.size,
      pull_count: pulls.length,
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

  function wishView({ characterId = activeCharacter, at = now() } = {}) {
    const world = typeof worldSnapshot === 'function' ? worldSnapshot() : null;
    const model = roleWishReadModel(world, { actorId: characterKey(characterId), at: new Date(at).toISOString() });
    const currentDirectionIds = canonicalCurrentDirectionIds(world, model.character_id, at);
    return { ...model, directions: model.directions.map(direction => ({ ...direction,
      proposal_gate: roles.wishGate(direction, { characterId: model.character_id, at, currentDirectionIds }),
    })) };
  }

  function canonicalCurrentDirectionIds(world, actorId, at = now()) {
    const model = roleStagesReadModel(world, { actorId, at: new Date(at).toISOString() });
    return Object.values(model.current ?? {}).filter(Boolean).map(stage => stage.direction_id);
  }

  function currentStages({ characterId = activeCharacter, limit = 10 } = {}) {
    const actorId = characterKey(characterId, activeCharacter), world = typeof worldSnapshot === 'function' ? worldSnapshot() : null;
    const model = roleStagesReadModel(world, { actorId, at: now().toISOString() });
    const current = Object.values(model.current ?? {}).filter(Boolean).map(stage => ({ ...clone(stage),
      schema: 'deskbot.role-state.v1', origin: 'canonical_role_stage', character_id: stage.actor_id,
      life: stage.label, stage_history: clone(stage.history ?? []),
      overlay: roleDirectionOverlay(stage.direction_id, { label: stage.label, life: stage.label }),
    }));
    const legacy = roles.currentStages?.({ characterId: actorId, limit: 10 }) ?? [];
    const selected = world?.role_stages?.schema === 'deskbot.role-stages.v1' ? current : [...current, ...legacy];
    return selected.slice(0, Math.min(Math.max(Number(limit) || 10, 1), 10));
  }

  function wishProposals({ characterId = activeCharacter, status = null, limit = 50 } = {}) {
    return roles.list({ characterId, status, limit }).map(proposal => {
      if (proposal.origin !== 'lived_wish') return proposal;
      const model = wishView({ characterId: proposal.character_id });
      const direction = model.directions.find(item => item.direction_id === proposal.direction_id);
      return projectPracticalTrial({ ...proposal,
        current_gate: clone(direction?.readiness ?? { eligible: false, barriers: [{ id: 'direction_unavailable', label: '这个方向当前没有可用的生活依据', scope: 'evidence' }], checks: [] }),
        proposal_gate: clone(direction?.proposal_gate ?? null),
        current_authored_reason: direction?.authored_reason ?? null,
      });
    });
  }

  function wishProposal(proposalId) {
    const proposal = roles.get(proposalId);
    if (!proposal || proposal.origin !== 'lived_wish') return proposal;
    const model = wishView({ characterId: proposal.character_id });
    const direction = model.directions.find(item => item.direction_id === proposal.direction_id);
    return projectPracticalTrial({ ...proposal, current_gate: clone(direction?.readiness ?? { eligible: false, barriers: [], checks: [] }),
      proposal_gate: clone(direction?.proposal_gate ?? null), current_authored_reason: direction?.authored_reason ?? null });
  }

  function projectPracticalTrial(proposal) {
    const world = typeof worldSnapshot === 'function' ? worldSnapshot() : null;
    const trial = practicalTrialReadModel(world, { proposalId: proposal.proposal_id, actorId: proposal.character_id, at: now().toISOString() });
    const registered = world?.protagonist?.character_id === proposal.character_id || world?.npcs?.some(item => item.npc_id === proposal.character_id);
    const available = proposal.status === 'prepared' && proposal.user_choice === 'try' && registered
      && Boolean(world?.memory?.development?.facets) && world?.clock?.mode === 'real_time'
      && PRACTICAL_TRIAL_DIRECTIONS.includes(proposal.direction_id) && !trial;
    const roleStage = roleStageReadModel(world, { proposalId: proposal.proposal_id, actorId: proposal.character_id, at: now().toISOString() });
    const preview = roleStagePreview(world, { proposal, at: now().toISOString() });
    return { ...proposal, practical_trial: trial, practical_trial_connected: Boolean(trial), practical_trial_available: Boolean(available),
      role_stage: roleStage, role_stage_preview: preview };
  }

  function stagePreview(proposalId) {
    const proposal = roles.get(proposalId);
    if (!proposal) return null;
    return roleStagePreview(typeof worldSnapshot === 'function' ? worldSnapshot() : null, { proposal, at: now().toISOString() });
  }

  function reconcileRoleStage(proposalId, world = typeof worldSnapshot === 'function' ? worldSnapshot() : null) {
    const proposal = roles.get(proposalId);
    if (!proposal || proposal.origin !== 'lived_wish') return proposal;
    const stage = roleStageReadModel(world, { proposalId, actorId: proposal.character_id, at: now().toISOString() });
    if (!stage) return proposal;
    const rolledBackAt = stage.status === 'rolled_back' ? stage.rolled_back_at : null;
    const direction = rolledBackAt ? roleWishReadModel(world, { actorId: proposal.character_id, at: rolledBackAt }).directions.find(item => item.direction_id === proposal.direction_id) : null;
    return roles.reconcileCanonicalStage(proposalId, stage, {
      reason: stage.accept_event_id ? inputStore.get?.(stage.accept_event_id)?.payload?.reason ?? null : null,
      rollbackReason: stage.rollback_event_id ? inputStore.get?.(stage.rollback_event_id)?.payload?.reason ?? null : null,
      rootOutcomeIds: direction?.basis?.root_outcome_ids ?? [],
    });
  }

  function reconcilePracticalExit(proposalId, world = typeof worldSnapshot === 'function' ? worldSnapshot() : null) {
    const proposal = roles.get(proposalId);
    if (!proposal || proposal.origin !== 'lived_wish') return proposal;
    const trial = practicalTrialReadModel(world, { proposalId, actorId: proposal.character_id, at: now().toISOString() });
    if (trial?.status !== 'exited' || proposal.practical_trial_exited_at) return proposal;
    const exitedAt = trial.exited_at ?? trial.ended_at;
    // Recovery can occur days after exit. Freeze only the canonical basis
    // that existed at the decision, so later actual life remains new evidence.
    const direction = roleWishReadModel(world, { actorId: proposal.character_id, at: exitedAt }).directions.find(item => item.direction_id === proposal.direction_id);
    return roles.exitPracticalWish(proposalId, { eventId: trial.exit_event_id ?? `practical-exit:${trial.trial_id}`,
      at: exitedAt, rootOutcomeIds: direction?.basis?.root_outcome_ids ?? [],
      reason: inputStore.get?.(trial.exit_event_id)?.payload?.reason ?? 'owner_exited_practical_trial' });
  }

  function archive(proposalId, options = {}) {
    const proposal = roles.get(proposalId);
    const world = typeof worldSnapshot === 'function' ? worldSnapshot() : null;
    const stage = proposal?.origin === 'lived_wish' ? roleStageReadModel(world, { proposalId, actorId: proposal.character_id, at: now().toISOString() }) : null;
    if (stage?.status === 'accepted') throw new RoleProposalError(409, 'role_stage_requires_rollback', '这份愿望已经采用为生活阶段，请先在阶段卡上回退；实际经历与材料后果会保留。');
    if (stage?.status === 'rolled_back') {
      reconcileRoleStage(proposalId, world);
      return roles.archive(proposalId, options);
    }
    const trial = proposal?.origin === 'lived_wish' ? practicalTrialReadModel(world, { proposalId, actorId: proposal.character_id, at: now().toISOString() }) : null;
    if (trial && trial.status !== 'exited') throw new RoleProposalError(409, 'practical_trial_requires_exit', '请先退出这份实际试做，再归档愿望，实际任务和经历会保留。');
    if (trial?.status === 'exited') reconcilePracticalExit(proposalId, world);
    return roles.archive(proposalId, options);
  }

  function proposeWish({ characterId = activeCharacter, directionId, proposalId = null } = {}) {
    const resolvedId = characterKey(characterId);
    const at = now();
    const model = wishView({ characterId: resolvedId, at });
    const direction = model.directions.find(item => item.direction_id === directionId);
    if (!model.enabled || direction?.readiness?.eligible !== true) throw new RoleProposalError(409, 'role_wish_not_ready', direction?.readiness?.barriers?.map(item => item.label).join('；') || '这个方向当前没有满足实际生活前提');
    const existing = proposalId ? roles.get(proposalId) : roles.list({ characterId: resolvedId, limit: 200 }).reverse().find(item => item.origin === 'lived_wish' && item.direction_id === directionId && ['proposed', 'prepared'].includes(item.status));
    if (existing) {
      if (existing.origin !== 'lived_wish' || existing.character_id !== resolvedId || existing.direction_id !== directionId || !['proposed', 'prepared'].includes(existing.status)) throw new RoleProposalError(409, 'role_wish_proposal_conflict', '这个提案编号已经属于另一份记录，不能覆盖或重开');
      return { duplicate: true, proposal: existing };
    }
    if (!direction?.proposal_gate?.eligible) throw new RoleProposalError(409, 'role_wish_not_ready', direction?.proposal_gate?.barriers?.map(item => item.label).join('；') || '这个方向暂不重提');
    const proposal = roles.propose(null, { characterId: resolvedId, proposalId: proposalId ?? nextWishId(resolvedId, directionId), now: at, livedWish: direction });
    return { duplicate: false, proposal };
  }

  function chooseWish(proposalId, choice, { reason = null } = {}) {
    const proposal = roles.get(proposalId);
    if (!proposal || proposal.origin !== 'lived_wish') {
      if (choice === 'try') assertLegacyTrialCanStart(proposal);
      return roles.choose(proposalId, choice, { reason });
    }
    const model = wishView({ characterId: proposal.character_id });
    const direction = model.directions.find(item => item.direction_id === proposal.direction_id);
    if (choice === 'try' && proposal.user_choice !== 'try' && direction?.proposal_gate?.barriers?.some(item => item.id === 'direction_already_current')) {
      throw new RoleProposalError(409, 'role_wish_direction_current', '这个方向已经是当前生活阶段，先继续实际生活。');
    }
    if (direction) roles.refreshWish(proposalId, direction, { at: now() });
    return roles.choose(proposalId, choice, { reason });
  }

  function assertLegacyTrialCanStart(proposal) {
    const facetsInstalled = typeof worldSnapshot === 'function' && Boolean(worldSnapshot()?.memory?.development?.facets);
    if (proposal && proposal.origin !== 'lived_wish' && facetsInstalled && !proposal.trial?.started_at) {
      throw new RoleProposalError(409, 'legacy_role_trial_requires_lived_wish', '这份旧草稿尚未开始试用；需要根据实际生活经历产生新的愿望，聊天轮次不能绕过生活前提。');
    }
  }

  function startTrial(proposalId, options = {}) {
    assertLegacyTrialCanStart(roles.get(proposalId));
    return roles.startTrial(proposalId, options);
  }

  function completeTrial(proposalId, options = {}) {
    assertLegacyTrialCanStart(roles.get(proposalId));
    return roles.completeTrial(proposalId, options);
  }

  function nextWishId(characterId, directionId) {
    if (typeof roles.nextWishId === 'function') return roles.nextWishId(characterId, directionId);
    const base = `role-wish:${characterId}:${directionId}`;
    const history = roles.list({ characterId, limit: 200 });
    if (!history.some(item => item.proposal_id === base)) return base;
    let revision = 2;
    while (history.some(item => item.proposal_id === `${base}-r${revision}`)) revision += 1;
    return `${base}-r${revision}`;
  }

  function syncWishes(characterId, at, world) {
    const model = roleWishReadModel(world, { actorId: characterId, at: at.toISOString() });
    const created = [];
    for (const proposal of roles.list({ characterId, limit: 200 })) {
      if (proposal.origin === 'lived_wish') reconcileRoleStage(proposal.proposal_id, world);
      if (proposal.origin === 'lived_wish' && !proposal.practical_trial_exited_at
        && practicalTrialReadModel(world, { proposalId: proposal.proposal_id, actorId: characterId, at: at.toISOString() })?.status === 'exited') {
        reconcilePracticalExit(proposal.proposal_id, world);
      }
    }
    if (model.enabled) {
      for (const proposal of roles.list({ characterId, limit: 200 })) {
        if (proposal.origin !== 'lived_wish' || !['proposed', 'deferred', 'prepared'].includes(proposal.status)) continue;
        const direction = model.directions.find(item => item.direction_id === proposal.direction_id);
        if (direction) roles.refreshWish(proposal.proposal_id, direction, { at });
      }
      for (const direction of model.directions) {
        const gate = roles.wishGate(direction, { characterId, at, currentDirectionIds: canonicalCurrentDirectionIds(world, characterId, at) });
        if (!gate.eligible) continue;
        const proposal = roles.propose(null, { characterId, proposalId: nextWishId(characterId, direction.direction_id), now: at, livedWish: direction });
        if (proposal) created.push(proposal);
        // A single announcement consumes the shared 24-hour window. Other
        // eligible axes remain visible and can be considered on a later day.
        break;
      }
    }
    const materialized = model.directions.map(direction => {
      const gate = roles.wishGate(direction, { characterId, at, currentDirectionIds: canonicalCurrentDirectionIds(world, characterId, at) });
      const proposal = roles.list({ characterId, limit: 200 }).reverse().find(item => item.origin === 'lived_wish' && item.direction_id === direction.direction_id);
      const current = { ...direction, proposal_gate: gate, proposal_id: proposal?.proposal_id ?? null, proposal_status: proposal?.status ?? null };
      const stateFingerprint = fingerprint({ direction: direction.fingerprint, gate: { eligible: gate.eligible,
        barriers: gate.barriers.map(item => item.id), cooldown_until: gate.cooldown_until, axis_conflict_id: gate.axis_conflict_id,
        last_proposal_id: gate.last_proposal_id, new_actual_root_ids: gate.new_actual_root_ids },
      proposal_id: current.proposal_id, proposal_status: current.proposal_status });
      const previous = candidates.get(candidateKey(characterId, direction.direction_id));
      if (previous?.state_fingerprint !== stateFingerprint) saveCandidate({
        schema: 'deskbot.role-evolution-candidate.v0.4', rule_version: WISH_RULE_VERSION,
        candidate_key: candidateKey(characterId, direction.direction_id), character_id: characterId,
        origin: 'lived_wish', evidence_basis: 'canonical_life_outcomes', direction_id: direction.direction_id,
        label: direction.label, life: direction.label, axis: direction.axis,
        status: direction.readiness.eligible ? 'candidate' : 'observing', fantasy_pull: null, score: null,
        evidence_ids: [...direction.basis.root_outcome_ids], evidence_count: direction.basis.root_outcome_ids.length,
        evidence_fingerprint: direction.fingerprint, state_fingerprint: stateFingerprint,
        readiness: clone(direction.readiness), wish_basis: clone(direction.basis), authored_reason: direction.authored_reason,
        next_step: direction.next_step, proposal_gate: clone(gate),
        proposal_id: proposal?.proposal_id ?? null, proposal_status: proposal?.status ?? null,
        first_seen_at: previous?.first_seen_at ?? at.toISOString(), updated_at: at.toISOString(),
      });
      return { direction_id: direction.direction_id, proposal_id: proposal?.proposal_id ?? null, proposal_status: proposal?.status ?? null,
        created: created.some(item => item.direction_id === direction.direction_id),
        suppressed: gate.barriers[0]?.id ?? null, evidence_fingerprint: direction.fingerprint };
    });
    const stateFingerprint = fingerprint({ model: model.fingerprint, materialized: materialized.map(({ created: _created, ...item }) => item) });
    const runId = `role-wish:${characterId}:${stateFingerprint.slice(0, 24)}`;
    const existingRun = runs.get(runId);
    if (existingRun && !created.length) { lastRunId = runId; return clone({ ...existingRun, created: [], duplicate: true }); }
    const run = saveRun({ schema: 'deskbot.role-evolution-run.v0.5', rule_version: WISH_RULE_VERSION,
      run_id: runId, character_id: characterId, started_at: at.toISOString(), completed_at: at.toISOString(),
      event_count: 0, event_ids: [], result_event_ids: [], event_fingerprint: null,
      evidence_basis: 'canonical_life_outcomes', evidence_revision: model.evidence_revision,
      wish_fingerprint: model.fingerprint, pulls: [], materialized, evidence_count: world?.memory?.development?.records?.length ?? 0,
      pull_count: 0, world_revision: world?.world_revision ?? null,
    });
    return clone({ ...run, created, duplicate: false });
  }

  function observeEvent(event) {
    if (!eventIsEligible(event)) return { ignored: true, reason: 'ineligible_event', run: null, trials: [] };
    const characterId = characterKey(event.character_id);
    const trials = [];
    const isUserChat = event.type === 'conversation.input'
      && (event.payload?.role === undefined || String(event.payload.role).toLowerCase() === 'user');
    if (isUserChat && typeof roles.activeTrials === 'function' && typeof roles.recordTrialObservation === 'function') {
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
    const world = typeof worldSnapshot === 'function' ? worldSnapshot() : null;
    const development = roleDevelopmentReadModel(world, { actorId: characterKey(characterId, activeCharacter) });
    const wishes = wishView({ characterId: characterKey(characterId, activeCharacter) });
    const candidateList = [...candidates.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .slice(-bounded)
      .map(item => {
        const ownDevelopment = item.character_id === development.character_id ? development
          : roleDevelopmentReadModel(world, { actorId: item.character_id });
        return { ...clone(item), evidence_basis: item.origin === 'lived_wish' ? 'canonical_life_outcomes' : 'legacy_input_cues', development_context: candidateDevelopmentContext(item, ownDevelopment) };
      });
    const runList = [...runs.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .slice(-bounded)
      .map(clone);
    const evidenceList = [...evidence.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .slice(-bounded)
      .map(clone);
    const pullList = [...pulls.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .slice(-bounded)
      .map(clone);
    return {
      schema: 'deskbot.role-evolution-snapshot.v0.3',
      rule_version: RULE_VERSION,
      active_character_id: activeCharacter,
      character_id: characterId,
      development,
      wishes,
      practical_trials: { ...practicalTrialsReadModel(world, { actorId: characterKey(characterId, activeCharacter), at: now().toISOString() }),
        available: Boolean(world?.memory?.development?.facets) && world?.clock?.mode === 'real_time' },
      role_stages: roleStagesReadModel(world, { actorId: characterKey(characterId, activeCharacter), at: now().toISOString() }),
      evidence: evidenceList,
      pulls: pullList,
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
    wishView,
    wishProposals,
    wishProposal,
    proposeWish,
    chooseWish,
    startTrial,
    completeTrial,
    archive,
    reconcilePracticalExit,
    reconcileRoleStage,
    stagePreview,
    currentStages,
    constants: {
      activeCharacter,
      evidenceNamespace: EVIDENCE_NAMESPACE,
      pullNamespace: PULL_NAMESPACE,
      candidateNamespace: CANDIDATE_NAMESPACE,
      runNamespace: RUN_NAMESPACE,
      cooldownNamespace: COOLDOWN_NAMESPACE,
      evidenceWindowDays,
      minProposalLogicalDays,
      ruleVersion: RULE_VERSION,
    },
  };
}

export {
  CANDIDATE_NAMESPACE,
  COOLDOWN_NAMESPACE,
  DEFAULT_CHARACTER_ID,
  EVIDENCE_NAMESPACE,
  EVIDENCE_WINDOW_DAYS,
  MAX_CANDIDATES,
  MAX_EVIDENCE,
  MAX_RUNS,
  MAX_PULLS,
  PULL_NAMESPACE,
  RUN_NAMESPACE,
  RULE_VERSION,
  eventIsEligible,
  proposalIdFor,
};
