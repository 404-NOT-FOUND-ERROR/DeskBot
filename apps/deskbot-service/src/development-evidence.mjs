import { createHash } from 'node:crypto';
import { ACTIVITIES, LIVING_RULE_VERSION } from './living-resources.mjs';
import { goalTopic } from './lived-memory.mjs';

// A projection of already settled world results, not another reward engine.
export const DEVELOPMENT_VERSION = 'deskbot.development-evidence.v1';
const MAX_RECORDS = 2048;
const TERMINAL_TASKS = new Set(['completed', 'failed', 'cancelled']);
const TERMINAL_COMMITMENTS = new Set(['completed', 'failed', 'withdrawn', 'declined']);
const sourceRank = { canonical_task: 3, canonical_commitment: 3, resident_project: 2, legacy_memory_fact: 1 };
const copy = value => structuredClone(value);
const string = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const strings = values => [...new Set((Array.isArray(values) ? values : []).map(string).filter(Boolean))].sort();
const validAt = (value, at) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(at);
const actorsIn = w => new Set([w?.protagonist?.character_id, ...(w?.npcs ?? []).map(n => n.npc_id)].filter(Boolean));
const rootForTask = id => `task:${id}`;
const emptyCounts = () => ({ roots: 0, practice: 0, relationship: 0, historical_import: 0, completed: 0, failed: 0, cancelled: 0 });
const emptyTopic = () => ({ roots: 0, practice: 0, completed: 0, failed: 0, cancelled: 0, own: 0, invited: 0, unknown_trigger: 0 });

function safeDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  return { source: string(decision.source), model: string(decision.model), request_id: string(decision.request_id), memory_ids: strings(decision.memory_ids) };
}

function sourceDetails(w, task, ids) {
  return ids.map(recordId => {
    // Execution-time metadata survives short input retention. Current references
    // can fill old gaps, but cannot override the task's original source snapshot.
    const snapshot = task.life_source_context?.find(record => record.record_id === recordId);
    const r = snapshot ?? w.refraction?.records?.find(record => record.id === recordId);
    const category = r?.category === 'dialogue' ? 'user' : r?.category;
    return { record_id: recordId, event_id: string(r?.event_id ?? r?.source_event_id), origin_id: string(r?.origin_id), category: ['user', 'weather', 'external', 'agent', 'body', 'world'].includes(category) ? category : 'unknown',
      input_category: string(r?.category), attested: r?.attested === true };
  });
}

function taskCauses(w, task) {
  const ids = strings(task.life_source_ids);
  const sources = sourceDetails(w, task, ids);
  const invited = task.social_commitment_id || task.origin === 'social_life'
    || sources.some(s => s.attested && ['user', 'agent'].includes(s.category));
  const unresolved = sources.some(s => !s.attested || s.category === 'unknown');
  return { source_record_ids: ids, source_event_ids: strings([task.cause_event_id, ...sources.flatMap(s => [s.event_id, s.origin_id])]), sources,
    plan_id: string(task.life_plan_id), decision: safeDecision(task.life_decision),
    trigger: invited ? 'invited' : !unresolved && task.origin === 'autonomous_life' && Array.isArray(task.life_source_ids) ? 'own' : 'unknown' };
}

const unknownCauses = () => ({ source_record_ids: [], source_event_ids: [], sources: [], plan_id: null, decision: null, trigger: 'unknown' });
function failureFor(outcome, reason, code = null) {
  return outcome === 'failed' || outcome === 'cancelled' ? { reason: string(reason)?.slice(0, 400) ?? null, code: string(code), classification: 'unclassified' } : null;
}

function titleFor(activityId, kind, action) {
  return ACTIVITIES.find(a => a.activity_id === activityId)?.title
    ?? (kind === 'travel' ? '实际出行结果' : action === 'rest' ? '实际休息结果' : '已记录的活动结果');
}

function recordBase(root, actorIds, at, outcome, source) {
  return { id: `development:${createHash('sha256').update(root).digest('hex').slice(0, 24)}`, root_outcome_id: root, actor_ids: actorIds, at, outcome,
    title: '已记录的活动结果', topic: null, activity_id: null, location_id: null, project_ids: [], source, causes: unknownCauses(),
    effect: { practice: false, relationship: false, legacy_interest_eligible: false, legacy_interest_known: false, completion_effect: 'unknown' },
    views: { memory_ids: [], project_stages: [], commitment_ids: [], linked_task_roots: [], conflicting_outcomes: [] }, failure: null };
}

function fromTask(w, task, at, registered) {
  const date = task.completion?.due_at ?? task.finished_at;
  if (!string(task.task_id) || !registered.has(task.actor_id) || !TERMINAL_TASKS.has(task.status) || !validAt(date, at)) return null;
  const r = recordBase(rootForTask(task.task_id), [task.actor_id], date, task.status,
    { kind: 'canonical_task', task_id: task.task_id, commitment_id: string(task.social_commitment_id), task_kind: string(task.kind) });
  r.activity_id = string(task.activity_id);
  r.title = titleFor(r.activity_id, task.kind, task.life_action);
  // The new finite gathering outcome joins the existing common ledger. Its
  // enacted recipe supplies the topic; a food-preparation plan is not cooking
  // competence and does not change the legacy interest scoring in this stage.
  r.topic = task.activity_id === 'gather-light-fruit' ? 'care' : goalTopic(task.life_goal ?? '') ?? goalTopic(task.activity_id ?? '');
  r.location_id = string(task.to_location_id ?? task.location_id ?? task.destination_location_id);
  r.project_ids = strings([task.project_id]);
  r.causes = taskCauses(w, task);
  // Keep attempts separate from successful effects. A failed or cancelled recipe
  // may have been attempted, while its material changes were never committed.
  r.effect = { practice: Boolean(r.topic && ACTIVITIES.some(a => a.activity_id === r.activity_id)
      && task.kind !== 'travel' && task.life_action !== 'rest' && task.completion_effect === LIVING_RULE_VERSION),
    relationship: false,
    legacy_interest_eligible: task.status !== 'cancelled' && task.kind !== 'travel' && task.life_action !== 'rest'
      && Boolean(goalTopic(task.life_goal ?? task.activity_id ?? '')) && !(task.life_source_ids?.length),
    legacy_interest_known: true,
    completion_effect: string(task.completion?.effect ?? task.completion_effect) ?? 'unknown' };
  if (task.project_id) r.views.project_stages.push({ project_id: task.project_id, stage_id: string(task.project_stage_id) });
  if (task.social_commitment_id) r.views.commitment_ids.push(task.social_commitment_id);
  r.failure = failureFor(r.outcome, task.failure_reason, task.failure_code);
  return r;
}

function fromProject(w, project, history, at, registered) {
  const evidence = (project.evidence ?? []).find(e => e.task_id === history.task_id);
  const actorId = history.actor_id ?? evidence?.actor_id ?? project.owner_id;
  if (!string(history.task_id) || !registered.has(actorId) || !TERMINAL_TASKS.has(history.outcome) || !validAt(history.at, at)) return null;
  const r = recordBase(rootForTask(history.task_id), [actorId], history.at, history.outcome,
    { kind: 'resident_project', task_id: history.task_id, commitment_id: null, task_kind: null, project_id: project.project_id });
  r.activity_id = string(history.activity_id ?? evidence?.activity_id);
  r.title = titleFor(r.activity_id);
  r.topic = goalTopic(r.activity_id ?? '') ?? goalTopic(project.project_id ?? '');
  r.location_id = string(history.location_id);
  r.project_ids = strings([project.project_id]);
  r.effect.practice = Boolean(r.topic && ACTIVITIES.some(a => a.activity_id === r.activity_id));
  r.effect.completion_effect = r.effect.practice ? 'historical_canonical_activity' : 'unknown';
  r.views.project_stages.push({ project_id: project.project_id, stage_id: string(history.stage_id ?? evidence?.stage_id) });
  r.failure = failureFor(r.outcome, history.reason);
  return r;
}

function fromEpisode(episode, at, registered) {
  const s = episode.source;
  if (episode.kind !== 'world_fact' || !s || !validAt(episode.at, at)) return null;
  let root;
  if (['canonical_task', 'resident_project'].includes(s.kind) && string(s.task_id) && TERMINAL_TASKS.has(episode.outcome)) root = rootForTask(s.task_id);
  else if (s.kind === 'canonical_commitment' && string(s.commitment_id) && TERMINAL_COMMITMENTS.has(episode.outcome)) root = `commitment:${s.commitment_id}`;
  else return null; // Body reports, hearsay, models and arbitrary world prose do not become practice.
  const actorIds = strings(episode.actor_ids).filter(id => registered.has(id));
  if (!actorIds.length) return null;
  const r = recordBase(root, actorIds, episode.at, episode.outcome,
    { kind: 'legacy_memory_fact', task_id: string(s.task_id), commitment_id: string(s.commitment_id), task_kind: null, original_kind: s.kind });
  r.activity_id = string(s.activity_id);
  r.title = s.kind === 'canonical_commitment' ? '实际约定结果' : titleFor(r.activity_id);
  r.topic = r.activity_id === 'gather-light-fruit' ? 'care' : string(episode.topic) ?? goalTopic(r.activity_id ?? s.project_id ?? '');
  r.location_id = string(episode.location_id);
  r.project_ids = strings([s.project_id]);
  r.causes.plan_id = string(s.plan_id);
  r.effect = { practice: Boolean(s.kind !== 'canonical_commitment' && r.topic && ACTIVITIES.some(a => a.activity_id === r.activity_id)),
    relationship: s.kind === 'canonical_commitment', legacy_interest_eligible: episode.independent_evidence === true,
    legacy_interest_known: ['canonical_task', 'canonical_commitment'].includes(s.kind) && typeof episode.independent_evidence === 'boolean',
    completion_effect: s.kind === 'canonical_commitment' ? 'canonical_relationship_outcome' : r.activity_id ? 'historical_canonical_activity' : 'unknown' };
  r.views.memory_ids = strings([episode.id]);
  if (s.project_id) r.views.project_stages.push({ project_id: s.project_id, stage_id: string(s.stage_id) });
  if (s.commitment_id) r.views.commitment_ids = [s.commitment_id];
  r.views.linked_task_roots = strings(s.task_ids).map(rootForTask);
  r.failure = failureFor(r.outcome, null);
  return r;
}

function commitmentTaskIds(w, c) {
  return strings([...Object.values(c.tasks ?? {}), ...(c.changes ?? []).map(change => change.task_id),
    ...(w.social?.recent ?? []).filter(e => e.commitment_id === c.id).map(e => e.task_id),
    ...(w.tasks ?? []).filter(t => t.social_commitment_id === c.id).map(t => t.task_id)]);
}

function fromCommitment(w, c, at, registered) {
  const actorIds = strings(c.actors).filter(id => registered.has(id));
  if (!string(c.id) || !actorIds.length || !TERMINAL_COMMITMENTS.has(c.status) || !validAt(c.finished_at, at)) return null;
  const r = recordBase(`commitment:${c.id}`, actorIds, c.finished_at, c.status,
    { kind: 'canonical_commitment', task_id: null, commitment_id: c.id, task_kind: null, commitment_kind: string(c.kind) });
  r.title = '实际约定结果'; r.topic = 'connection'; r.location_id = string(c.location_id);
  r.causes.trigger = 'invited';
  r.effect = { practice: false, relationship: true, legacy_interest_eligible: ['completed', 'failed'].includes(c.status), legacy_interest_known: true, completion_effect: 'canonical_relationship_outcome' };
  r.views.commitment_ids = [c.id]; r.views.linked_task_roots = commitmentTaskIds(w, c).map(rootForTask);
  r.failure = failureFor(r.outcome, c.failure_reason);
  return r;
}

function unionObjects(a, b, key) {
  const entries = new Map(a.map(value => [key(value), value]));
  for (const value of b) if (!entries.has(key(value))) entries.set(key(value), value);
  return [...entries].sort(([x], [y]) => x.localeCompare(y)).map(([, value]) => value);
}

function mergeRecord(old, incoming) {
  if (!old) return incoming;
  const best = (sourceRank[incoming.source.kind] ?? 0) > (sourceRank[old.source.kind] ?? 0) ? incoming : old;
  const other = best === old ? incoming : old;
  const r = copy(best);
  r.historical_import = old.historical_import;
  r.first_observed_at = old.first_observed_at;
  // Canonical task/commitment participants are authoritative. A historical
  // project view must not give its owner credit for a helper's actual task.
  r.actor_ids = strings(best.actor_ids.length ? best.actor_ids : other.actor_ids);
  r.activity_id ??= other.activity_id; r.location_id ??= other.location_id; r.topic ??= other.topic;
  r.project_ids = strings([...old.project_ids, ...incoming.project_ids]);
  if (!r.effect.legacy_interest_known && other.effect.legacy_interest_known) {
    r.effect.legacy_interest_eligible = other.effect.legacy_interest_eligible;
    r.effect.legacy_interest_known = true;
  }
  const causes = r.causes;
  causes.source_record_ids = strings([...old.causes.source_record_ids, ...incoming.causes.source_record_ids]);
  causes.source_event_ids = strings([...old.causes.source_event_ids, ...incoming.causes.source_event_ids]);
  causes.sources = unionObjects(old.causes.sources.filter(s => s.category !== 'unknown'), incoming.causes.sources.filter(s => s.category !== 'unknown'), s => s.record_id);
  causes.sources = unionObjects(causes.sources, [...old.causes.sources, ...incoming.causes.sources], s => s.record_id);
  causes.plan_id ??= other.causes.plan_id; causes.decision ??= other.causes.decision;
  if (causes.trigger === 'unknown' && other.causes.trigger !== 'unknown') causes.trigger = other.causes.trigger;
  for (const key of ['memory_ids', 'commitment_ids', 'linked_task_roots']) r.views[key] = strings([...old.views[key], ...incoming.views[key]]);
  r.views.project_stages = unionObjects(old.views.project_stages, incoming.views.project_stages, s => `${s.project_id}:${s.stage_id ?? ''}`);
  r.views.conflicting_outcomes = unionObjects(old.views.conflicting_outcomes ?? [], incoming.views.conflicting_outcomes ?? [], s => `${s.source_kind}:${s.outcome}`);
  if (old.outcome !== incoming.outcome) r.views.conflicting_outcomes = unionObjects(r.views.conflicting_outcomes, [{ source_kind: other.source.kind, outcome: other.outcome }], s => `${s.source_kind}:${s.outcome}`);
  if (!r.failure?.reason && other.failure?.reason && best.outcome === other.outcome) r.failure = copy(other.failure);
  return r;
}

export function syncDevelopmentEvidence(w, at) {
  if (!w?.memory || !validAt(at, at)) return { enabled: false, changed: false };
  const fresh = !w.memory.development;
  w.memory.development ??= { schema: DEVELOPMENT_VERSION, installed_at: at, revision: 0, records: [], retention: { max_records: MAX_RECORDS, counts_scope: 'retained_unique_root_outcomes' } };
  const development = w.memory.development;
  const before = JSON.stringify(development.records), registered = actorsIn(w);
  const records = new Map(development.records.map(r => [r.root_outcome_id, copy(r)]));
  let added = 0;
  function add(candidate) {
    if (!candidate) return;
    const prior = records.get(candidate.root_outcome_id);
    if (!prior) {
      candidate.historical_import = fresh || Date.parse(candidate.at) < Date.parse(development.installed_at);
      candidate.first_observed_at = at; added++;
    }
    records.set(candidate.root_outcome_id, mergeRecord(prior, candidate));
  }
  for (const task of w.tasks ?? []) add(fromTask(w, task, at, registered));
  for (const project of Object.values(w.resident_projects?.projects ?? {})) for (const history of project.history ?? []) add(fromProject(w, project, history, at, registered));
  for (const c of w.social?.commitments ?? []) add(fromCommitment(w, c, at, registered));
  for (const episode of w.memory.episodes ?? []) {
    const candidate = fromEpisode(episode, at, registered);
    if (candidate) episode.root_outcome_id = candidate.root_outcome_id;
    add(candidate);
  }
  // A commitment adds a relationship view, never a second practice for its tasks.
  for (const c of w.social?.commitments ?? []) for (const taskId of commitmentTaskIds(w, c)) {
    const record = records.get(rootForTask(taskId));
    if (record) record.views.commitment_ids = strings([...record.views.commitment_ids, c.id]);
  }
  development.records = [...records.values()].sort((a, b) => a.at.localeCompare(b.at) || a.root_outcome_id.localeCompare(b.root_outcome_id)).slice(-MAX_RECORDS);
  const changed = fresh || before !== JSON.stringify(development.records);
  if (changed) development.revision++;
  return { enabled: true, installed: fresh, changed, added_roots: added, revision: development.revision };
}

export function developmentReadModel(w, { actorId = null, limit = 48 } = {}) {
  const development = w?.memory?.development, ownerId = w?.protagonist?.character_id ?? null;
  const requestedLimit = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(MAX_RECORDS, Math.trunc(Number(limit)))) : 48;
  const records = (development?.records ?? []).filter(r => !actorId || r.actor_ids.includes(actorId));
  const counts = emptyCounts(), actors = new Map();
  for (const record of records) {
    counts.roots++;
    if (record.effect.practice) counts.practice++;
    if (record.effect.relationship) counts.relationship++;
    if (record.historical_import) counts.historical_import++;
    if (Object.hasOwn(counts, record.outcome)) counts[record.outcome]++;
    for (const id of record.actor_ids) {
      if (actorId && actorId !== id) continue;
      let actor = actors.get(id);
      if (!actor) {
        actor = { actor_id: id, display_name: id === ownerId ? w.protagonist.display_name : w.npcs?.find(n => n.npc_id === id)?.display_name ?? id, roots: 0, practice: 0, relationship: 0, topics: {} };
        actors.set(id, actor);
      }
      actor.roots++; actor.practice += Number(record.effect.practice); actor.relationship += Number(record.effect.relationship);
      if (!record.topic) continue;
      const topic = actor.topics[record.topic] ??= emptyTopic(); topic.roots++;
      if (!record.effect.practice) continue;
      topic.practice++;
      if (['completed', 'failed', 'cancelled'].includes(record.outcome)) topic[record.outcome]++;
      topic[record.causes.trigger === 'own' ? 'own' : record.causes.trigger === 'invited' ? 'invited' : 'unknown_trigger']++;
    }
  }
  return { schema: DEVELOPMENT_VERSION, enabled: Boolean(development), installed_at: development?.installed_at ?? null, revision: development?.revision ?? 0, owner_id: ownerId,
    counts, actors: [...actors.values()].sort((a, b) => a.actor_id.localeCompare(b.actor_id)), recent: copy(requestedLimit ? records.slice(-requestedLimit).reverse() : []),
    coverage: { retention: copy(development?.retention ?? { max_records: MAX_RECORDS, counts_scope: 'retained_unique_root_outcomes' }),
      historical_import_roots: counts.historical_import,
      causality_unknown_roots: records.filter(r => r.causes.trigger === 'unknown' || r.causes.sources.some(s => s.category === 'unknown')).length,
      limitations: ['统计是保留的唯一结果及其连接数量，不是经验值、技能等级或兴趣成熟度。', '历史导入只使用仍保留的任务、项目与记忆；缺失的旧经历和前因保持未知。', '观察、出行和休息保留事实，但本阶段不记为产生资源或设施变化的实践。', '失败原因保持原事务记录，尚不推断不喜欢某事或个人能力不足。', '来源只展示类别和编号，不复制私人输入、模型理由或自定义活动说明。'] } };
}
