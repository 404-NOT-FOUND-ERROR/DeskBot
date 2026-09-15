export function createRoleProposal(pull, { proposalId = `proposal-${pull.direction_id}`, now = new Date(), cooldownMs = 24 * 3600000 } = {}) {
  if (!pull || pull.status !== 'candidate') return null;
  return {
    schema: 'deskbot.role-direction-proposal.v0.1',
    proposal_id: proposalId,
    direction_id: pull.direction_id,
    label: pull.label,
    life: pull.life,
    fantasy_pull: pull.fantasy_pull,
    evidence_ids: [...pull.evidence_ids],
    proposed_at: new Date(now).toISOString(),
    cooldown_until: new Date(new Date(now).getTime() + cooldownMs).toISOString(),
    status: 'proposed',
    user_choices: ['try', 'later', 'reject'],
    prompt_hint: `我最近总被${pull.life}吸引。我想试试“${pull.label}”的生活，你愿意陪我先试一段吗？`,
  };
}

const CHOICES = new Set(['try', 'later', 'reject']);

export function createRoleProposalStore({ persistence = null, now = () => new Date() } = {}) {
  const proposals = new Map((persistence?.list('role.proposals') ?? []).map((item) => [item.proposal_id, item]));
  const decisions = new Map((persistence?.list('role.proposal-decisions') ?? []).map((item) => [item.decision_id, item]));
  const clone = (value) => structuredClone(value);
  function propose(pull, options = {}) {
    const proposal = createRoleProposal(pull, { ...options, now: options.now ?? now() });
    if (!proposal) return null;
    const existing = proposals.get(proposal.proposal_id);
    if (existing) return clone(existing);
    proposals.set(proposal.proposal_id, proposal);
    persistence?.put('role.proposals', proposal.proposal_id, proposal);
    return clone(proposal);
  }
  function choose(proposalId, choice, { reason = null } = {}) {
    if (!CHOICES.has(choice)) throw new TypeError('choice must be try, later, or reject');
    const proposal = proposals.get(proposalId);
    if (!proposal) return null;
    const decision = { schema: 'deskbot.role-proposal-decision.v0.1', decision_id: `${proposalId}:${choice}`, proposal_id: proposalId, choice, reason, decided_at: now().toISOString() };
    if (!decisions.has(decision.decision_id)) { decisions.set(decision.decision_id, decision); persistence?.put('role.proposal-decisions', decision.decision_id, decision); }
    const status = choice === 'try' ? 'trying' : choice === 'later' ? 'deferred' : 'rejected';
    const updated = { ...proposal, status, user_choice: choice, decided_at: decision.decided_at, stage_history: [...(proposal.stage_history ?? []), { from: proposal.status, to: status, at: decision.decided_at, reason }] };
    if (choice === 'try' && !updated.trial) updated.trial = null;
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated);
    return clone({ proposal: updated, decision });
  }
  function startTrial(proposalId, { windowTurns = 5 } = {}) {
    const p = proposals.get(proposalId); if (!p) return null;
    if (p.status !== 'trying') throw new Error('only trying proposals can start trial');
    if (p.trial?.status === 'active') return clone(p);
    const t = now().toISOString();
    const updated = { ...p, trial: { started_at: t, max_turns: windowTurns, turns_observed: 0, positive_feedback: 0, negative_feedback: 0, evidence_ids: [], observations: [], status: 'active' } };
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function recordTrialObservation(proposalId, { eventId, signal = 'neutral', evidenceId = null } = {}) {
    const p = proposals.get(proposalId); if (!p) return null;
    if (p.status !== 'trying' || p.trial?.status !== 'active') throw new Error('trial is not active');
    if (!eventId) throw new TypeError('eventId is required');
    if (p.trial.observations.some(o => o.event_id === eventId)) return clone(p);
    const obs = { event_id: eventId, signal, evidence_id: evidenceId, observed_at: now().toISOString() };
    const tr = { ...p.trial, turns_observed: p.trial.turns_observed + 1, positive_feedback: p.trial.positive_feedback + (signal === 'positive'), negative_feedback: p.trial.negative_feedback + (signal === 'negative'), evidence_ids: evidenceId ? [...p.trial.evidence_ids, evidenceId] : p.trial.evidence_ids, observations: [...p.trial.observations, obs] };
    if (tr.turns_observed >= tr.max_turns) tr.status = 'completed';
    const updated = { ...p, trial: tr }; proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function completeTrial(proposalId, { decision = 'deferred', reason = null } = {}) {
    const p = proposals.get(proposalId); if (!p?.trial) return null;
    if (!['accepted','rejected','deferred'].includes(decision)) throw new TypeError('invalid trial decision');
    const at = now().toISOString();
    const nextStatus = decision === 'accepted' ? 'accepted' : decision;
    const updated = { ...p, status: nextStatus, stage_history: [...(p.stage_history ?? []), { from: p.status, to: nextStatus, at, reason }], trial: { ...p.trial, status: decision === 'accepted' ? 'completed' : 'rolled_back', completed_at: at, completion_reason: reason } };
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function archive(proposalId, { reason = null } = {}) {
    const p = proposals.get(proposalId); if (!p) return null;
    const at = now().toISOString();
    const updated = { ...p, previous_status: p.status, status: 'archived', archived_at: at, archive_reason: reason, stage_history: [...(p.stage_history ?? []), { from: p.status, to: 'archived', at, reason }] };
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  return { propose, choose, startTrial, recordTrialObservation, completeTrial, archive, get: (id) => clone(proposals.get(id) ?? null), list: () => [...proposals.values()].map(clone), decisions: () => [...decisions.values()].map(clone) };
}
