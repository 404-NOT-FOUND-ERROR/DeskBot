/**
 * Read-only actor perception projection.
 *
 * The world observer may see the whole town. A character does not. This
 * projection is the boundary shared by chat, life choice and slow cognition:
 * witnessed facts are limited to the actor's participation or current place;
 * delivered/public notices are hear-say; everything else is unknown. It never
 * writes memory or canonical world state.
 */
import { worldMessageInbox } from './world-message-transport.mjs';
export const ACTOR_PERCEPTION_SCHEMA = 'deskbot.actor-perception.v1';
export const ACTOR_COGNITION_SCHEMA = 'deskbot.actor-cognition.v1';

const clone = value => value === undefined ? undefined : structuredClone(value);
const ids = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [];
const has = (values, value) => ids(values).includes(value);
const TOPIC_SET = new Set(['care', 'craft', 'repair', 'cook', 'explore', 'connection']);
const PLACE_TOPICS = Object.freeze({ 'moss-sprout-garden': 'care', 'warm-pot-courtyard': 'cook',
  'spare-parts-house': 'craft', 'tidal-old-road': 'explore', 'echo-waterside': 'explore',
  'backlit-grove': 'explore', 'fog-lamp-square': 'explore', 'whisper-market': 'explore' });
const topicFor = item => TOPIC_SET.has(item?.topic) ? item.topic
  : TOPIC_SET.has(item?.development_topic) ? item.development_topic
    : item?.source?.kind === 'canonical_commitment' || item?.source?.kind === 'canonical_notice' ? 'connection'
      : PLACE_TOPICS[item?.location_id] ?? null;
const travelling = (world, actorId) => (world?.tasks ?? []).some(task => task.actor_id === actorId
  && task.kind === 'travel' && ['running', 'paused'].includes(task.status));

function actorFor(world, actorId) {
  if (world?.protagonist?.character_id === actorId) return world.protagonist;
  return (world?.npcs ?? []).find(item => item.npc_id === actorId) ?? null;
}

function samePlace(actor, item) {
  return Boolean(actor?.location_id && item?.location_id && actor.location_id === item.location_id);
}

function eventAccess(event, actorId, actor, { legacyPublic = false } = {}) {
  const participants = ids(event?.participants ?? event?.actor_ids ?? event?.participant_ids);
  const audience = ids(event?.audience ?? event?.audience_ids ?? event?.visible_to);
  const hasScope = Boolean(event?.location_id || participants.length || audience.length || event?.recipient_id
    || event?.target_character_id || event?.visibility || event?.public === false);
  const publicEvent = event?.public === true || event?.visibility === 'public' || event?.audience === 'public'
    || (!hasScope && (legacyPublic || event?.source === 'world-engine' || event?.kind === 'world_line'
      || (event?.source_commitment_id && event?.verified_by === 'canonical_world_record')));
  const participated = has(participants, actorId);
  const delivered = has(audience, actorId) || event?.recipient_id === actorId || event?.target_character_id === actorId;
  const observed = samePlace(actor, event);
  if (participated) return { visibility: 'witnessed', witnessed: true, delivered: false, public: publicEvent, observed: true };
  if (delivered) return { visibility: 'delivered', witnessed: false, delivered: true, public: publicEvent, observed: false };
  if (publicEvent) return { visibility: 'public', witnessed: false, delivered: false, public: true, observed: false };
  if (event?.visibility === 'private' || event?.public === false && audience.length) {
    return { visibility: 'unknown', witnessed: false, delivered: false, public: false, observed: false };
  }
  if (observed) return { visibility: 'observed', witnessed: false, delivered: false, public: false, observed: true };
  return { visibility: 'unknown', witnessed: false, delivered: false, public: false, observed: false };
}

function project(item, access) {
  return { ...clone(item), perception: access };
}

export function actorPerception(world, actorId = world?.protagonist?.character_id, at = world?.clock?.synced_at ?? world?.updated_at) {
  const storedActor = actorFor(world, actorId);
  if (!storedActor) return { schema: ACTOR_PERCEPTION_SCHEMA, actor_id: actorId ?? null, actor_found: false,
    location_id: null, scene: null, active_event: null, latest_event: null, notices: [], messages: [], nearby_npcs: [], unknown: [] };

  // A traveller's stored location is the last confirmed departure point. It
  // must not grant continuing sight of that place or of the destination.
  const actor = travelling(world, actorId) ? { ...storedActor, location_id: null } : storedActor;

  const scene = world?.life?.current_scene ?? null;
  const sceneAccess = scene ? eventAccess(scene, actorId, actor) : null;
  const activeEvent = world?.active_event ?? null;
  const activeAccess = activeEvent ? eventAccess(activeEvent, actorId, actor) : null;
  const latestEvent = world?.world_line?.latest_event ?? null;
  // The canonical world-line stream is an authored public notice. Its
  // individual event payload need not repeat a visibility field.
  const latestAccess = latestEvent ? eventAccess(latestEvent, actorId, actor, { legacyPublic: true }) : null;
  const notices = (world?.social?.notices ?? []).map(notice => ({ notice, access: eventAccess(notice, actorId, actor) }))
    .filter(item => item.access.visibility !== 'unknown')
    .slice(-12)
    .map(item => project(item.notice, item.access));
  const nearby = (world?.npcs ?? []).filter(npc => npc.npc_id !== actorId && samePlace(actor, npc) && !travelling(world, npc.npc_id))
    .map(npc => project(npc, { visibility: 'observed', witnessed: false, delivered: false, public: false, observed: true }));
  const unknown = [
    activeAccess?.visibility === 'unknown' ? { kind: 'active_event', id: activeEvent?.event_id ?? null } : null,
    latestAccess?.visibility === 'unknown' ? { kind: 'latest_event', id: latestEvent?.event_id ?? null } : null,
    sceneAccess?.visibility === 'unknown' ? { kind: 'scene', id: scene?.scene_id ?? null } : null,
  ].filter(Boolean);
  const worldEvents = (world?.world_line?.recent_events ?? []).map(event => ({ event, access: eventAccess(event, actorId, actor, { legacyPublic: true }) }))
    .filter(item => item.access.visibility !== 'unknown').slice(-12).map(item => project(item.event, item.access));
  return {
    schema: ACTOR_PERCEPTION_SCHEMA, actor_id: actorId, actor_found: true,
    location_id: actor.location_id ?? null,
    scene: sceneAccess && sceneAccess.visibility !== 'unknown' ? project(scene, sceneAccess) : null,
    active_event: activeAccess && activeAccess.visibility !== 'unknown' ? project(activeEvent, activeAccess) : null,
    latest_event: latestAccess && latestAccess.visibility !== 'unknown' ? project(latestEvent, latestAccess) : null,
    notices, messages: worldMessageInbox(world, actorId, at), world_events: worldEvents, nearby_npcs: nearby, unknown,
  };
}

/**
 * Bounded input for an NPC's own cognition.  This is deliberately narrower
 * than the observer projection: only canonical facts attached to the actor,
 * the actor's current place, delivered notices, and public world-line events
 * cross this boundary.  Dialogue, model reflections and the observer's
 * complete world snapshot are never treated as facts here.
 */
export function actorCognitionContext(world, actorId = world?.protagonist?.character_id, at = null) {
  const view = actorPerception(world, actorId, at ?? world?.clock?.synced_at ?? world?.updated_at);
  if (!view.actor_found) return {
    schema: ACTOR_COGNITION_SCHEMA, actor_id: actorId ?? null, observed_at: at,
    witnessed_facts: [], same_place: [], delivered: [], public: [], nearby_npcs: [], unknown: view.unknown,
  };
  const until = at ? Date.parse(at) : Number.POSITIVE_INFINITY;
  const validAt = value => !Number.isFinite(until) || !value || Date.parse(value) <= until;
  const sourceKinds = new Set(['canonical_task', 'resident_project', 'canonical_commitment']);
  const facts = (world?.memory?.episodes ?? [])
    .filter(item => item?.kind === 'world_fact' && item.model_safe === true && Array.isArray(item.actor_ids) && item.actor_ids.includes(actorId)
      && sourceKinds.has(item.source?.kind) && validAt(item.at))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)))
    .slice(0, 12)
    .map(item => ({ id: item.id, at: item.at, topic: item.topic ?? null, outcome: item.outcome ?? null,
      source_kind: item.source.kind, text: item.model_text ?? item.text ?? null, visibility: 'witnessed' }));
  const scene = view.scene ? {
    id: view.scene.scene_id ?? null, title: view.scene.title ?? null,
    location_id: view.scene.location_id ?? null, topic: topicFor(view.scene), visibility: view.scene.perception.visibility,
  } : null;
  const events = (view.world_events ?? []).filter(item => validAt(item.occurred_at)).map(item => ({ id: item.event_id ?? null,
    title: item.title ?? null, topic: topicFor(item), location_id: item.location_id ?? null,
    visibility: item.perception?.visibility ?? 'public' }));
  const notices = (view.notices ?? []).map(item => ({ id: item.id ?? item.notice_id ?? null,
    text: item.text ?? item.summary ?? null, topic: topicFor(item), location_id: item.location_id ?? null,
    visibility: item.perception?.visibility ?? 'delivered' }));
  const messages = (view.messages ?? []).map(item => ({ id: item.id, sender_id: item.sender_id ?? null,
    text: item.content ?? null, topic: topicFor(item), at: item.at ?? null, source: clone(item.source),
    ...(item.invitation_state ? { invitation_state: item.invitation_state, actionable: item.actionable, historical_only: item.historical_only } : {}),
    visibility: 'delivered', independent_evidence: false }));
  return {
    schema: ACTOR_COGNITION_SCHEMA, actor_id: actorId, observed_at: at ?? null,
    witnessed_facts: facts,
    same_place: [scene, ...(view.active_event ? [{ id: view.active_event.event_id ?? null,
      title: view.active_event.title ?? null, topic: topicFor(view.active_event), location_id: view.active_event.location_id ?? null,
      visibility: view.active_event.perception?.visibility ?? 'observed' }] : [])].filter(Boolean),
    delivered: [...notices.filter(item => item.visibility === 'delivered'), ...messages],
    public: events.filter(item => item.visibility === 'public'),
    nearby_npcs: (view.nearby_npcs ?? []).map(item => ({ npc_id: item.npc_id, display_name: item.display_name ?? null,
      location_id: item.location_id ?? null, visibility: item.perception?.visibility ?? 'observed' })),
    unknown: structuredClone(view.unknown ?? []),
  };
}

/** Apply a very small preference from what an actor could actually perceive.
 * This can reorder existing legal choices, never creates one and never writes
 * canonical state. Source ids are retained for audit/read models only. */
export function influenceActorCognitionChoices(world, actorId, choices, at = null) {
  const context = actorCognitionContext(world, actorId, at);
  const byTopic = new Map();
  for (const fact of context.witnessed_facts) if (fact.topic) byTopic.set(fact.topic, Math.max(byTopic.get(fact.topic) ?? 0, 3));
  for (const event of [...context.same_place, ...context.delivered]) if (event.topic && !event.historical_only) {
    const weight = event.visibility === 'delivered' ? 2 : 3;
    byTopic.set(event.topic, Math.max(byTopic.get(event.topic) ?? 0, weight));
  }
  for (const event of context.public) if (event.topic) byTopic.set(event.topic, Math.max(byTopic.get(event.topic) ?? 0, 1));
  return (Array.isArray(choices) ? choices : []).map(choice => {
    const topic = choice.development_topic ?? null;
    const baseScore = choice.score - (choice.perception_bonus ?? 0);
    const bonus = choice.available && topic && baseScore < 40 ? Math.min(3, byTopic.get(topic) ?? 0) : 0;
    const sourceItems = bonus ? [...context.witnessed_facts, ...context.same_place, ...context.delivered, ...context.public]
      .filter(item => item.topic === topic && item.id && !item.historical_only).slice(0, 4) : [];
    const sourceIds = sourceItems.map(item => item.id);
    const sourceMetadata = sourceItems.map(item => ({ id: item.id, visibility: item.visibility,
      source: item.source?.kind ?? (item.visibility === 'witnessed' ? 'canonical_fact' : 'perception') }));
    return { ...choice, score: choice.score - (choice.perception_bonus ?? 0) + bonus,
      perception_bonus: bonus, perception_source_ids: sourceIds,
      perception_sources: sourceMetadata };
  }).sort((a, b) => b.score - a.score);
}

export function perceptionNarrativeLabel(item) {
  switch (item?.perception?.visibility) {
    case 'witnessed': return '亲历记录';
    case 'observed': return '同地观察';
    case 'delivered': return '收到的消息';
    case 'public': return '公开消息';
    default: return '未知';
  }
}
