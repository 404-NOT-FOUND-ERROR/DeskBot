import { createHash } from 'node:crypto';
import { developmentReadModel } from './development-evidence.mjs';
import { localWorldDate } from './realtime-world.mjs';
import { developmentFacetsReadModel } from './development-facets.mjs';

export const ROLE_DEVELOPMENT_SCHEMA = 'deskbot.role-development.v1';
const MAX_ROOTS = 2048;

// Author-defined correspondences describe relevant practice. They are not a
// preference score, a capability judgement or a reason to create a role.
export const DEVELOPMENT_DIRECTIONS = Object.freeze([
  Object.freeze({ direction_id: 'wetland_frog', label: '荷叶青蛙', topics: ['care', 'explore'], locations: ['moss-sprout-garden', 'echo-waterside'], availability: 'existing_direction', mapping_note: '苗圃和水岸的照料、观察实践；做过不等于喜欢，也不等于想成为青蛙。' }),
  Object.freeze({ direction_id: 'workshop_maker', label: '工坊学徒', topics: ['craft', 'repair'], locations: null, availability: 'existing_direction', mapping_note: '制作与修缮的实际结果；次数不表示能力成熟。' }),
  Object.freeze({ direction_id: 'starry_observer', label: '星空观察者', topics: [], locations: null, availability: 'existing_direction', mapping_note: '尚无明确的观星实践活动，普通观察小镇不作为观星经历。' }),
  Object.freeze({ direction_id: 'dream_cloud', label: '云朵梦境生物', topics: [], locations: null, availability: 'existing_direction', mapping_note: '尚无对应实际试用活动，梦境或漂浮对白不作为实践。' }),
  Object.freeze({ direction_id: 'chef', label: '厨师方向', topics: ['cook'], locations: null, availability: 'future_direction', mapping_note: '只观察做饭实践；主动愿望、角色提案与解锁尚未实现。' }),
]);

const unique = values => [...new Set(values.filter(value => typeof value === 'string' && value))].sort();
const barriers = () => [
  { id: 'self_wish_not_established', label: '主动愿望还未建立' },
  { id: 'practical_trial_not_connected', label: '实际方向试用尚未接入' },
  { id: 'capability_self_assessment_next_stage', label: '能力自评留待下一阶段' },
];
const facetBarriers=()=>[
  {id:'self_wish_not_established',label:'主动愿望还未建立'},
  {id:'practical_trial_not_connected',label:'实际方向试用尚未接入'},
  {id:'role_prerequisites_not_authored',label:'各方向的成为条件尚待设计'},
];

function directionFacets(direction,model,actorId,mappedRoots,records) {
  if(!model.enabled)return {preference:null,capability:null,self_assessment:null,wish_stability:null};
  const topics=(model.actors.find(a=>a.actor_id===actorId)?.topics??[]).filter(t=>direction.topics.includes(t.topic));
  const ids=new Set(mappedRoots.map(r=>r.root_outcome_id));
  const practiceIds=new Set(records.map(r=>r.root_outcome_id));
  const filter=(roots,subset=ids)=>[...(roots??[])].filter(id=>subset.has(id));
  return {
    preference:{basis:'explicit_continuation_separate_from_success',scope:'related_topic_attention',
      topics:topics.map(t=>({topic:t.topic,status:t.interest.status,summary:t.interest.summary,
        active_roots:filter(t.interest.active_roots),invited_roots:filter(t.interest.invited_roots),
        obligation_roots:filter(t.interest.obligation_roots),unknown_roots:filter(t.interest.unknown_roots)}))},
    capability:{basis:'actual_registered_activity_outcomes',scope:'direction_mapped_activity_roots',
      success_roots:unique(topics.flatMap(t=>filter(t.capability.success_roots,practiceIds))),
      performance_failure_roots:unique(topics.flatMap(t=>filter(t.capability.performance_failure_roots,practiceIds))),
      condition_failure_roots:unique(topics.flatMap(t=>filter(t.capability.condition_failure_roots,practiceIds))),
      unknown_failure_roots:unique(topics.flatMap(t=>filter(t.capability.unknown_failure_roots,practiceIds))),
      topics:topics.map(t=>({topic:t.topic,scope:'related_topic_summary',status:t.capability.status,summary:t.capability.summary})),
      prerequisite_evidence_basis:'direction_mapped_activity_roots_only'},
    self_assessment:{basis:'rules',scope:'related_topic_summary',
      topics:topics.map(t=>({topic:t.topic,status:t.self_assessment.status,summary:t.self_assessment.summary})),
      root_outcome_ids:unique(topics.flatMap(t=>filter(t.self_assessment.root_outcome_ids)))},
    wish_stability:{status:'not_established',automatic:false,
      related_topics_stable:topics.filter(t=>t.wish?.stable_interest===true).map(t=>t.topic),
      direction_prerequisites_ready:false},
  };
}

function practiceRoots(model, actorId) {
  const roots = new Map();
  for (const record of model?.recent ?? []) {
    if (!record.root_outcome_id || !record.actor_ids?.includes(actorId)
      || record.effect?.practice !== true || !['completed', 'failed'].includes(record.outcome)) continue;
    if (!roots.has(record.root_outcome_id)) roots.set(record.root_outcome_id, record);
  }
  return [...roots.values()].sort((a, b) => String(a.root_outcome_id).localeCompare(String(b.root_outcome_id)));
}

function ownerLinked(record) {
  return (record.causes?.sources ?? []).some(source => source.category === 'user' && source.attested === true);
}

/** Pure read: the canonical ledger supplies all evidence; no input events are manufactured. */
export function roleDevelopmentReadModel(world, { actorId = world?.protagonist?.character_id ?? 'shaping-001' } = {}) {
  const ledger = developmentReadModel(world, { actorId, limit: MAX_ROOTS });
  const roots = practiceRoots(ledger, actorId);
  const facets=ledger?.facets??developmentFacetsReadModel(world,{actorId,at:world?.clock?.synced_at??world?.updated_at});
  const timeZone = world?.clock?.time_zone ?? 'Asia/Shanghai';
  const directions = DEVELOPMENT_DIRECTIONS.map(direction => {
    const records = roots.filter(record => direction.topics.includes(record.topic)
      && (!direction.locations || direction.locations.includes(record.location_id)));
    const mappedRoots=(ledger?.recent??[]).filter(record=>record.actor_ids.includes(actorId)&&direction.topics.includes(record.topic)
      &&(!direction.locations||direction.locations.includes(record.location_id)));
    const days = unique(records.map(record => localWorldDate(record.at, timeZone)?.date));
    const contexts = unique(records.map(record => record.activity_id && record.location_id ? `${record.activity_id}:${record.location_id}` : null));
    return {
      direction_id: direction.direction_id,
      label: direction.label,
      status: records.length ? 'observing' : 'not_observed',
      availability: direction.availability,
      authored_mapping: { topics: [...direction.topics], location_ids: direction.locations ? [...direction.locations] : null, note: direction.mapping_note },
      root_outcome_ids: records.map(record => record.root_outcome_id),
      evidence_count: records.length,
      counts: {
        completed: records.filter(record => record.outcome === 'completed').length,
        failed: records.filter(record => record.outcome === 'failed').length,
        autonomous: records.filter(record => record.causes?.trigger === 'own').length,
        invited: records.filter(record => record.causes?.trigger === 'invited').length,
        owner_linked: records.filter(ownerLinked).length,
        unknown_trigger: records.filter(record => !['own', 'invited'].includes(record.causes?.trigger)).length,
      },
      practice_days: days,
      contexts,
      day_count: days.length,
      context_count: contexts.length,
      unknown_context_count: records.filter(record => !record.activity_id || !record.location_id).length,
      records: records.map(record => ({
        root_outcome_id: record.root_outcome_id,
        development_record_id: record.id,
        topic: record.topic,
        outcome: record.outcome,
        at: record.at,
        activity_id: record.activity_id ?? null,
        location_id: record.location_id ?? null,
        trigger: record.causes?.trigger ?? 'unknown',
        owner_linked: ownerLinked(record),
        historical_import: Boolean(record.historical_import),
        // View references identify the same root. They never add to counts.
        views: structuredClone(record.views ?? {}),
      })),
      ...directionFacets(direction,facets,actorId,mappedRoots,records),
      unlocked: false,
      barriers: facets.enabled?facetBarriers():barriers(),
    };
  });
  const evidenceFingerprint = createHash('sha256').update(JSON.stringify(roots.map(record => ({
    root: record.root_outcome_id, topic: record.topic, outcome: record.outcome, at: record.at,
    activity_id: record.activity_id ?? null, location_id: record.location_id ?? null,
    trigger: record.causes?.trigger ?? 'unknown', owner_linked: ownerLinked(record),
  })))).digest('hex');
  return {
    schema: ROLE_DEVELOPMENT_SCHEMA,
    enabled: ledger?.enabled === true,
    mode: facets.enabled?'direction_facets_only':'direction_observation_only',
    character_id: actorId,
    evidence_basis: 'canonical_unique_root_outcomes',
    practice_counts_scope: 'completed_or_failed_recipe_outcomes',
    unlock_status_scope: 'new_development_pipeline_only',
    ledger_schema: ledger?.schema ?? null,
    evidence_count: roots.length,
    evidence_fingerprint: evidenceFingerprint,
    directions,
    coverage: structuredClone(ledger?.coverage ?? {}),
    interpretation: {
      successful_practice_is_preference: false,
      failed_practice_is_negative_preference: false,
      practice_count_is_capability: false,
      capability_basis:'registered_activity_outcomes_with_classified_difficulties',
      observed_direction_is_self_wish: false,
      automatic_proposals_enabled: false,
      appearance_changes_enabled: false,
    },
    legacy_context: {
      input_evidence_basis: 'legacy_input_cues',
      input_cues_are_practice: false,
      trial_evidence_basis: 'dialogue_turns_and_feedback',
      trial_turns_are_practice: false,
      lifecycle_changed: false,
    },
  };
}

/** Add context to an old candidate without changing its score or lifecycle. */
export function candidateDevelopmentContext(candidate, development) {
  const direction = development?.directions.find(item => item.direction_id === candidate.direction_id);
  return {
    mode: development?.mode??'direction_observation_only',
    evidence_basis: 'canonical_unique_root_outcomes',
    mapped: Boolean(direction),
    root_outcome_ids: [...(direction?.root_outcome_ids ?? [])],
    evidence_count: direction?.evidence_count ?? 0,
    counts: structuredClone(direction?.counts ?? { completed: 0, failed: 0, autonomous: 0, invited: 0, owner_linked: 0, unknown_trigger: 0 }),
    practice_days: [...(direction?.practice_days ?? [])],
    contexts: [...(direction?.contexts ?? [])],
    preference:structuredClone(direction?.preference??null),
    capability:structuredClone(direction?.capability??null),
    self_assessment:structuredClone(direction?.self_assessment??null),
    wish_stability:structuredClone(direction?.wish_stability??null),
    unlocked: false,
    lifecycle_changed: false,
    barriers:structuredClone(direction?.barriers??barriers()),
  };
}
