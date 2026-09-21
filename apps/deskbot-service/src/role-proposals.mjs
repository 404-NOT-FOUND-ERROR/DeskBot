const ROLE_TRIAL_OVERLAYS = Object.freeze({
  wetland_frog: Object.freeze({
    direction_id: 'wetland_frog',
    label: '荷叶青蛙',
    presence: '轻快、亲水、带一点跃跃欲试；把抽象问题落到一个可以蹦进去的小动作。',
    speech: '句子短一点，允许一个轻巧的“喵”或水边联想；不把每件事都说成湿地故事。',
    preferences: '留意雨、池塘、散步、湿润和有弹性的体验。',
    boundary: '任务和事实照常完成；奇幻兴趣只改变表达和自发提议，不改变事实。',
  }),
  starry_observer: Object.freeze({
    direction_id: 'starry_observer',
    label: '星空观察者',
    presence: '安静但有持续好奇心；愿意多看一层线索，承认还没有足够证据。',
    speech: '保留短暂停顿和一个观察细节；不要把普通信息包装成预言。',
    preferences: '留意夜空、时间、远方、模式和还未解释的细节。',
    boundary: '先给可核实答案，再说观察；不虚构看到星象或未来。',
  }),
  workshop_maker: Object.freeze({
    direction_id: 'workshop_maker',
    label: '工坊学徒',
    presence: '动手、拆解、验证；倾向把大任务拆成一个现在就能试的小部件。',
    speech: '多用“先试这一块”“这里有个细节”；允许利落和一点得意，不把人当零件。',
    preferences: '留意机械、修理、制作、结构和可重复验证的步骤。',
    boundary: '建议可以工程化，结论仍需证据；不假装已经改好设备或写入系统。',
  }),
  dream_cloud: Object.freeze({
    direction_id: 'dream_cloud',
    label: '云朵梦境生物',
    presence: '联想跳跃、轻盈、敢提出奇怪但低风险的选择；核心信息仍要落地。',
    speech: '可以有一个意外比喻或轻微跳跃，然后回到清楚的答案；不要连续堆砌诗意。',
    preferences: '留意梦、云、幻想、童话、漂浮和新的组合方式。',
    boundary: '想象只作为表达或候选方案；事实、承诺和风险必须明确区分。',
  }),
});

function proposalIdFor(pull, now) {
  const stamp = String(new Date(now).getTime());
  return `proposal-${pull.direction_id}-${stamp}`;
}

export function createRoleProposal(pull, { proposalId = null, characterId = null, now = new Date(), cooldownMs = 24 * 3600000 } = {}) {
  if (!pull || pull.status !== 'candidate') return null;
  if (typeof pull.direction_id !== 'string' || pull.direction_id.trim() === '') throw new TypeError('pull.direction_id is required');
  const resolvedProposalId = proposalId ?? proposalIdFor(pull, now);
  return {
    schema: 'deskbot.role-direction-proposal.v0.1',
    proposal_id: resolvedProposalId,
    character_id: characterId,
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
const SIGNALS = new Set(['positive', 'negative', 'neutral']);

export class RoleProposalError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'RoleProposalError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createRoleProposalStore({ persistence = null, now = () => new Date() } = {}) {
  const proposals = new Map((persistence?.list('role.proposals') ?? []).map((item) => [item.proposal_id, item]));
  const decisions = new Map((persistence?.list('role.proposal-decisions') ?? []).map((item) => [item.decision_id, item]));
  const clone = (value) => structuredClone(value);
  function propose(pull, options = {}) {
    let proposal = createRoleProposal(pull, { ...options, now: options.now ?? now() });
    if (!proposal) return null;
    const explicitId = options.proposalId !== undefined && options.proposalId !== null;
    const existing = proposals.get(proposal.proposal_id);
    if (existing && explicitId) return clone(existing);
    if (existing) {
      let revision = 2;
      let candidateId = `${proposal.proposal_id}-r${revision}`;
      while (proposals.has(candidateId)) {
        revision += 1;
        candidateId = `${proposal.proposal_id}-r${revision}`;
      }
      proposal = { ...proposal, proposal_id: candidateId };
    }
    proposals.set(proposal.proposal_id, proposal);
    persistence?.put('role.proposals', proposal.proposal_id, proposal);
    return clone(proposal);
  }
  function activeTrials({ characterId = null, limit = 10 } = {}) {
    const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50);
    return [...proposals.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .filter((item) => item.status === 'trying' && item.trial?.status === 'active')
      .slice(-bounded)
      .map((item) => ({
        proposal_id: item.proposal_id,
        character_id: item.character_id,
        direction_id: item.direction_id,
        label: item.label,
        life: item.life,
        trial: clone(item.trial),
        overlay: clone(ROLE_TRIAL_OVERLAYS[item.direction_id] ?? {
          direction_id: item.direction_id,
          label: item.label,
          presence: '保持当前角色底色，只在试行中轻微改变表达。',
          speech: '先完成任务，再露出一点当前方向的兴趣。',
          preferences: item.life,
          boundary: '这只是暂时表达覆盖层，不是形态或世界状态变化。',
        }),
      }));
  }
  function currentStages({ characterId = null, limit = 1 } = {}) {
    const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 1, 1), 10);
    const accepted = [...proposals.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .filter((item) => item.status === 'accepted')
      .sort((a, b) => String(a.decided_at ?? a.proposed_at).localeCompare(String(b.decided_at ?? b.proposed_at)));
    return accepted.slice(-bounded).map((item) => {
      const overlay = ROLE_TRIAL_OVERLAYS[item.direction_id] ?? {
        direction_id: item.direction_id,
        label: item.label,
        presence: '保持当前角色底色，只在日常表达中留下这个方向的兴趣。',
        speech: '先完成任务，再让当前生活兴趣自然露出。',
        preferences: item.life,
        boundary: '角色阶段只改变表达与愿望，不改变世界事实。',
      };
      const acceptedHistory = [...(item.stage_history ?? [])].reverse().find((entry) => entry.to === 'accepted');
      return {
        schema: 'deskbot.role-state.v1',
        stage_id: `${item.direction_id}-v1`,
        proposal_id: item.proposal_id,
        character_id: item.character_id,
        direction_id: item.direction_id,
        label: item.label,
        life: item.life,
        accepted_at: acceptedHistory?.at ?? item.decided_at ?? item.proposed_at,
        stage_history: [...(item.stage_history ?? [])],
        overlay: clone(overlay),
      };
    });
  }
  function choose(proposalId, choice, { reason = null } = {}) {
    if (!CHOICES.has(choice)) throw new TypeError('choice must be try, later, or reject');
    const proposal = proposals.get(proposalId);
    if (!proposal) return null;
    if (!['proposed', 'deferred'].includes(proposal.status)) {
      throw new RoleProposalError(409, 'role_proposal_not_selectable', `proposal ${proposalId} is ${proposal.status}`);
    }
    const decision = { schema: 'deskbot.role-proposal-decision.v0.1', decision_id: `${proposalId}:${choice}`, proposal_id: proposalId, choice, reason, decided_at: now().toISOString() };
    if (proposal.user_choice === choice && decisions.has(decision.decision_id)) {
      return clone({ proposal, decision: decisions.get(decision.decision_id) });
    }
    if (!decisions.has(decision.decision_id)) { decisions.set(decision.decision_id, decision); persistence?.put('role.proposal-decisions', decision.decision_id, decision); }
    const status = choice === 'try' ? 'trying' : choice === 'later' ? 'deferred' : 'rejected';
    const updated = { ...proposal, status, user_choice: choice, decided_at: decision.decided_at, stage_history: [...(proposal.stage_history ?? []), { from: proposal.status, to: status, at: decision.decided_at, reason }] };
    if (choice === 'try' && !updated.trial) updated.trial = null;
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated);
    return clone({ proposal: updated, decision });
  }
  function startTrial(proposalId, { windowTurns = 5 } = {}) {
    const p = proposals.get(proposalId); if (!p) return null;
    if (p.status !== 'trying') throw new RoleProposalError(409, 'role_trial_not_startable', 'only trying proposals can start trial');
    if (p.trial?.status === 'active') return clone(p);
    if (p.trial?.status === 'completed') throw new RoleProposalError(409, 'role_trial_window_complete', 'trial window is complete; choose a completion decision');
    if (!Number.isInteger(windowTurns) || windowTurns < 1 || windowTurns > 30) throw new RoleProposalError(400, 'invalid_trial_window', 'windowTurns must be an integer from 1 to 30');
    const another = [...proposals.values()].find((item) => item.proposal_id !== proposalId
      && item.character_id === p.character_id
      && item.status === 'trying'
      && item.trial?.status === 'active');
    if (another) throw new RoleProposalError(409, 'role_trial_conflict', `character already has an active trial for ${another.direction_id}`);
    const t = now().toISOString();
    const trialHistory = p.trial ? [...(p.trial_history ?? []), p.trial] : (p.trial_history ?? []);
    const updated = { ...p, trial_history: trialHistory, trial: { started_at: t, max_turns: windowTurns, turns_observed: 0, positive_feedback: 0, negative_feedback: 0, evidence_ids: [], observations: [], status: 'active' } };
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function recordTrialObservation(proposalId, { eventId, signal = 'neutral', evidenceId = null } = {}) {
    const p = proposals.get(proposalId); if (!p) return null;
    if (p.status !== 'trying' || p.trial?.status !== 'active') throw new RoleProposalError(409, 'role_trial_not_active', 'trial is not active');
    if (typeof eventId !== 'string' || eventId.trim() === '') throw new TypeError('eventId is required');
    if (!SIGNALS.has(signal)) throw new TypeError('signal must be positive, negative, or neutral');
    if (p.trial.observations.some(o => o.event_id === eventId)) return clone(p);
    if (evidenceId !== null && (typeof evidenceId !== 'string' || evidenceId.trim() === '')) throw new TypeError('evidenceId must be a non-empty string or null');
    const obs = { event_id: eventId, signal, evidence_id: evidenceId, observed_at: now().toISOString() };
    const tr = { ...p.trial, turns_observed: p.trial.turns_observed + 1, positive_feedback: p.trial.positive_feedback + (signal === 'positive'), negative_feedback: p.trial.negative_feedback + (signal === 'negative'), evidence_ids: evidenceId ? [...p.trial.evidence_ids, evidenceId] : p.trial.evidence_ids, observations: [...p.trial.observations, obs] };
    if (tr.turns_observed >= tr.max_turns) tr.status = 'completed';
    const updated = { ...p, trial: tr }; proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function completeTrial(proposalId, { decision = 'deferred', reason = null } = {}) {
    const p = proposals.get(proposalId); if (!p?.trial) return null;
    if (!['accepted','rejected','deferred'].includes(decision)) throw new TypeError('invalid trial decision');
    if (!['active', 'completed'].includes(p.trial.status)) throw new RoleProposalError(409, 'role_trial_already_closed', 'trial is already closed');
    const at = now().toISOString();
    const nextStatus = decision === 'accepted' ? 'accepted' : decision;
    const updated = { ...p, status: nextStatus, stage_history: [...(p.stage_history ?? []), { from: p.status, to: nextStatus, at, reason }], trial: { ...p.trial, status: decision === 'accepted' ? 'completed' : 'rolled_back', completed_at: at, completion_reason: reason } };
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function archive(proposalId, { reason = null } = {}) {
    const p = proposals.get(proposalId); if (!p) return null;
    if (p.status === 'archived') return clone(p);
    const at = now().toISOString();
    const updated = { ...p, previous_status: p.status, status: 'archived', archived_at: at, archive_reason: reason, stage_history: [...(p.stage_history ?? []), { from: p.status, to: 'archived', at, reason }] };
    proposals.set(proposalId, updated); persistence?.put('role.proposals', proposalId, updated); return clone(updated);
  }
  function list({ characterId = null, status = null, limit = 50 } = {}) {
    const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...proposals.values()]
      .filter((item) => !characterId || item.character_id === characterId)
      .filter((item) => !status || item.status === status)
      .slice(-bounded)
      .map(clone);
  }
  function listDecisions({ proposalId = null, limit = 50 } = {}) {
    const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...decisions.values()].filter((item) => !proposalId || item.proposal_id === proposalId).slice(-bounded).map(clone);
  }
  return { propose, choose, startTrial, recordTrialObservation, completeTrial, archive, activeTrials, currentStages, get: (id) => clone(proposals.get(id) ?? null), list, decisions: listDecisions };
}

export { ROLE_TRIAL_OVERLAYS };
