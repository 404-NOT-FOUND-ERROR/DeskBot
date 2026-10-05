import { worldHopAccess, findWorldPath } from './world-map-content.mjs';
import { DEFAULT_CHARACTER_ID, canonicalCharacterId, canonicalLocationId } from './world-definition.mjs';
import { prepareLivingActivity, completeLivingActivity, releaseLivingReservation } from './living-resources.mjs';
import { syncLifeNeeds, finishLifeTask } from './life-state.mjs';
import { settleProjectTask } from './resident-projects.mjs';

export class RealTimeWorldError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const fail = (code, message, status = 409) => { throw new RealTimeWorldError(status, code, message); };
const active = task => ['running', 'paused'].includes(task.status);
const isRealTime = world => world.clock?.mode === 'real_time';
const iso = value => {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) fail('invalid_task_time', 'A valid UTC timestamp is required', 400);
  return new Date(ms).toISOString();
};
const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) fail('invalid_world_task', `${field} requires text up to 500 characters`, 400);
  return value.trim();
};

export function localWorldDate(value, timeZone = 'Asia/Shanghai') {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute_of_day: Number(parts.hour) * 60 + Number(parts.minute) };
}

export function applyRealTimeClock(world, at, timeZone = 'Asia/Shanghai') {
  const timestamp = iso(at);
  const previous = world.clock;
  if (isRealTime(world) && timestamp < previous.synced_at) return { accepted: false, reason: 'clock_moved_backwards' };
  const local = localWorldDate(timestamp, previous?.time_zone ?? timeZone);
  const originDate = previous?.origin_date ?? local.date;
  const baseDay = previous?.base_day ?? world.logical_time.day;
  const days = Math.round((Date.parse(`${local.date}T00:00:00Z`) - Date.parse(`${originDate}T00:00:00Z`)) / 86400000);
  world.clock = {
    schema: 'deskbot.real-time-clock.v1', mode: 'real_time', rate: 1,
    time_zone: previous?.time_zone ?? timeZone, origin_date: originDate, base_day: baseDay,
    anchored_at: previous?.anchored_at ?? timestamp, synced_at: timestamp, local_date: local.date,
    migration: previous?.migration ?? { from: 'logical_clock', at: timestamp, previous_logical_time: structuredClone(world.logical_time) },
  };
  world.logical_time.day = baseDay + days;
  world.logical_time.minute_of_day = local.minute_of_day;
  world.logical_time.date = local.date;
  world.logical_time.time_zone = world.clock.time_zone;
  world.calendar = { ...world.calendar, date: local.date, timezone: world.clock.time_zone, observed_at: timestamp };
  world.tasks ??= [];
  return { accepted: true, clock: structuredClone(world.clock), migrated: !previous };
}

export function activeWorldTask(world, actorId = DEFAULT_CHARACTER_ID) {
  const id = canonicalCharacterId(actorId);
  return (world.tasks ?? []).find(task => task.actor_id === id && active(task)) ?? null;
}

function actor(world, id) {
  const actorId = canonicalCharacterId(id);
  if (actorId === world.protagonist.character_id) return world.protagonist;
  const npc = world.npcs.find(item => item.npc_id === actorId);
  if (!npc) fail('task_actor_not_found', 'The task actor must exist in this world', 404);
  return npc;
}

function available(world, actorId) {
  if (!isRealTime(world)) fail('real_time_tasks_required', 'Persistent tasks require a real-time world');
  if (activeWorldTask(world, actorId)) fail('actor_busy', 'The actor already has a running or paused task');
  return actor(world, actorId);
}

function route(world, from, destination) {
  if (!world.locations.some(place => place.location_id === destination)) fail('task_destination_unknown', 'The destination is not in the world', 400);
  const path = findWorldPath(world, from, destination);
  if (!path) fail('location_not_reachable', 'There is no valid route to the destination');
  return path;
}

function requireHop(world, from, to) {
  const access = worldHopAccess(world, from, to);
  if (!access.allowed) fail(access.code, access.reason);
}

function travelDuration(world, destination) {
  const value = world.locations.find(place => place.location_id === destination)?.travel_cost ?? 10;
  if (!Number.isSafeInteger(value) || value < 1 || value > 10080) fail('invalid_travel_duration', 'Travel cost must be positive minutes', 400);
  return value * 60000;
}

function retainTasks(world) {
  const completed = (world.tasks ?? []).filter(task => !active(task)).sort((a, b) => String(b.finished_at).localeCompare(String(a.finished_at))).slice(0, 100);
  world.tasks = [...world.tasks.filter(active), ...completed];
}

function recordTask(world, task) {
  world.tasks ??= [];
  if (world.tasks.some(item => item.task_id === task.task_id)) fail('task_id_conflict', 'Task ID is already used');
  if (world.tasks.filter(active).length >= 100) fail('task_capacity_reached', 'Too many unfinished tasks');
  world.tasks.push(task);
  retainTasks(world);
}

function reflectTravel(world, task) {
  const currentActor = actor(world, task.actor_id);
  currentActor.travel_state = {
    status: task.status === 'completed' ? 'arrived' : task.status === 'running' ? 'travelling' : task.status,
    task_id: task.task_id, from_location_id: task.from_location_id, to_location_id: task.to_location_id,
    destination_location_id: task.destination_location_id, event_id: task.cause_event_id, reason: task.title,
    started_at: task.segment_started_at, due_at: task.due_at, remaining_ms: task.remaining_ms,
    arrived_at: task.status === 'completed' ? task.finished_at : null,
    travel_cost_minutes: task.duration_ms / 60000, steps_completed: task.steps_completed,
    arrival_text: task.status === 'completed' ? world.locations.find(place => place.location_id === task.to_location_id)?.arrival_text ?? null : null,
  };
  if (task.actor_id !== world.protagonist.character_id) currentActor.status = task.status === 'completed' ? task.arrival_status ?? '已抵达' : task.status === 'running' ? '正在路上' : task.status === 'paused' ? '出行暂停' : '出行未完成';
}

export function startTravelTask(world, { eventId, at, actorId = DEFAULT_CHARACTER_ID, locationId, destinationId = locationId, reason = null, arrivalStatus = null }) {
  const person = available(world, actorId);
  const timestamp = iso(at);
  if (timestamp < world.clock.synced_at) fail('clock_moved_backwards', 'Clock moved backwards; wait for it to recover');
  const first = canonicalLocationId(text(locationId, 'location_id'));
  const final = canonicalLocationId(text(destinationId, 'destination_location_id'));
  const origin = person.location_id;
  if (origin === final) fail('already_at_location', 'The actor is already at the destination');
  requireHop(world, origin, first);
  route(world, first, final);
  const duration = travelDuration(world, first);
  const task = {
    schema: 'deskbot.world-task.v1', task_id: `travel-${text(eventId, 'event_id')}`, kind: 'travel', actor_id: person.character_id ?? person.npc_id,
    status: 'running', revision: 0, cause_event_id: eventId,
    title: `前往${world.locations.find(place => place.location_id === final)?.name}`,
    reason: reason === null ? null : text(reason, 'reason'),
    started_at: timestamp, updated_at: timestamp, segment_started_at: timestamp, due_at: new Date(Date.parse(timestamp) + duration).toISOString(),
    duration_ms: duration, remaining_ms: duration, from_location_id: origin, to_location_id: first,
    destination_location_id: final, steps_completed: 0, history: [], arrival_status: arrivalStatus,
    finished_at: null, failure_reason: null, completion: null,
  };
  recordTask(world, task);
  if (task.actor_id === world.protagonist.character_id && world.life?.current_scene) {
    world.life.recent_scenes = [...(world.life.recent_scenes ?? []), { ...world.life.current_scene, status: 'ended', ended_at: timestamp }].slice(-12);
    world.life.current_scene = null;
  }
  reflectTravel(world, task);
  return { task_id: task.task_id, task: structuredClone(task), travel_status: 'travelling', departure_text: `我出发去${world.locations.find(place => place.location_id === final)?.name}了，第一段大约${duration / 60000}分钟。`, arrival_text: null };
}

export function startActivityTask(world, payload, { eventId, at }) {
  const actorId = canonicalCharacterId(payload.actor_id ?? DEFAULT_CHARACTER_ID);
  const person = available(world, actorId);
  const authored = payload.activity_id ? prepareLivingActivity(world, payload.activity_id, actorId, at) : null;
  const kind = authored?.kind ?? payload.kind;
  if (!['craft', 'care'].includes(kind)) fail('invalid_task_kind', 'Activity kind must be craft or care', 400);
  const seconds = authored?.duration_seconds ?? payload.duration_seconds;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 604800) fail('invalid_task_duration', 'Activity duration must be 1 to 604800 seconds', 400);
  const timestamp = iso(at);
  if (timestamp < world.clock.synced_at) fail('clock_moved_backwards', 'Clock moved backwards; wait for it to recover');
  const task = {
    schema: 'deskbot.world-task.v1', task_id: text(payload.task_id, 'task_id'), kind, actor_id: actorId,
    title: authored?.title ?? text(payload.title, 'title'), status: 'running', revision: 0, cause_event_id: eventId,
    location_id: person.location_id, started_at: timestamp, updated_at: timestamp,
    due_at: new Date(Date.parse(timestamp) + seconds * 1000).toISOString(), duration_ms: seconds * 1000, remaining_ms: seconds * 1000,
    completion_effect: authored?.completion_effect ?? 'record_activity_only', ...(authored ? { activity_id: authored.activity_id, target_object_id: authored.target_object_id, reservation: authored.reservation,
      ...(authored.project_id ? { project_id: authored.project_id, project_stage_id: authored.project_stage_id, project_attempt: authored.project_attempt, project_version: authored.project_version,
        ...(authored.project_batch_id ? { project_batch_id: authored.project_batch_id } : {}) } : {}) } : {}),
    finished_at: null, failure_reason: null, completion: null, history: [],
  };
  recordTask(world, task);
  return { task_id: task.task_id, task: structuredClone(task) };
}

export function controlWorldTask(world, payload, at) {
  const task = world.tasks?.find(item => item.task_id === payload.task_id);
  if (!task) fail('task_not_found', 'Task not found', 404);
  if (!active(task)) fail('task_terminal', 'A completed, failed, or cancelled task cannot be controlled');
  const timestamp = iso(at);
  if (timestamp < task.updated_at || timestamp < world.clock.synced_at) fail('clock_moved_backwards', 'Task time cannot move backwards');
  const operation = payload.operation;
  syncLifeNeeds(world, timestamp);
  if (!['pause', 'resume', 'cancel'].includes(operation)) fail('invalid_task_operation', 'Use pause, resume, or cancel', 400);
  if (operation === 'pause') {
    if (task.status !== 'running') fail('task_not_running', 'Only a running task can pause');
    if (timestamp >= task.due_at) fail('task_due', 'Reconcile a due task before pausing');
    task.remaining_ms = Math.max(0, Date.parse(task.due_at) - Date.parse(timestamp));
    task.status = 'paused';
  } else if (operation === 'resume') {
    if (task.status !== 'paused') fail('task_not_paused', 'Only a paused task can resume');
    if (task.kind === 'travel') requireHop(world, task.from_location_id, task.to_location_id);
    task.due_at = new Date(Date.parse(timestamp) + task.remaining_ms).toISOString();
    if (task.kind === 'travel') task.segment_started_at = new Date(Date.parse(task.due_at) - task.duration_ms).toISOString();
    task.status = 'running';
  } else {
    task.status = 'cancelled';
    task.failure_code = 'activity_cancelled';
    task.failure_classification = 'cancelled';
    task.finished_at = timestamp;
    if (task.activity_id) releaseLivingReservation(world, task, timestamp);
  }
  task.updated_at = timestamp;
  task.revision += 1;
  task.history.push({ operation, at: timestamp });
  task.history = task.history.slice(-100);
  if (task.kind === 'travel') reflectTravel(world, task);
  if (task.status === 'cancelled') settleProjectTask(world, task, timestamp);
  retainTasks(world);
  return { task_id: task.task_id, task: structuredClone(task) };
}

export function advanceWorldTask(world, payload, at) {
  const task = world.tasks?.find(item => item.task_id === payload.task_id);
  if (!task) fail('task_not_found', 'Task not found', 404);
  if (task.status !== 'running' || task.revision !== payload.expected_task_revision) fail('task_state_changed', 'Task state changed before execution');
  const timestamp = iso(at);
  if (timestamp < task.due_at) fail('task_not_due', 'Task has not reached its real-time deadline');
  const dueAt = task.due_at;
  syncLifeNeeds(world, dueAt);
  if (task.activity_id && world.living?.simulated_until !== dueAt) fail('task_environment_not_ready', '先按到期顺序补算环境，再核验这项活动。');
  const person = actor(world, task.actor_id);
  let error = null;
  let activityResult = null;
  if (task.kind === 'travel') {
    if (person.location_id !== task.from_location_id) error = 'location_changed';
    else { const access = worldHopAccess(world,task.from_location_id,task.to_location_id); if (!access.allowed) error = access.code === 'location_not_reachable' ? 'route_changed' : access.code; }
    if (!error) {
      person.location_id = task.to_location_id;
      task.steps_completed += 1;
      task.history.push({ operation: 'arrive', location_id: task.to_location_id, due_at: dueAt, reconciled_at: timestamp });
      if (person.location_id !== task.destination_location_id) {
        try {
          const next = route(world, person.location_id, task.destination_location_id)[1];
          task.from_location_id = person.location_id;
          task.to_location_id = next;
          task.duration_ms = travelDuration(world, next);
          task.remaining_ms = task.duration_ms;
          task.segment_started_at = dueAt;
          task.due_at = new Date(Date.parse(dueAt) + task.duration_ms).toISOString();
        } catch (cause) {
          if (!(cause instanceof RealTimeWorldError)) throw cause;
          error = cause.code;
        }
      } else task.status = 'completed';
    }
  } else {
    if (person.location_id !== task.location_id) error = 'location_changed';
    else if (task.activity_id) {
      activityResult = completeLivingActivity(world, task, dueAt);
      if (activityResult.success) task.status = 'completed';
      else error = activityResult.reason;
    } else task.status = 'completed';
  }
  if (error) { task.status = 'failed'; task.failure_reason = error;
    task.failure_code = activityResult?.code ?? error;
    task.failure_classification = activityResult?.classification ?? (['location_changed', 'route_changed', 'passage_closed', 'location_closed', 'location_not_reachable'].includes(error) ? 'route' : 'unclassified');
    if (task.activity_id) releaseLivingReservation(world, task, timestamp); }
  if (task.status !== 'running') {
    finishLifeTask(world, task, dueAt);
    task.finished_at = timestamp;
    task.remaining_ms = 0;
    task.completion = { due_at: dueAt, reconciled_at: timestamp, late: timestamp > dueAt,
      effect: task.status === 'failed' ? 'no_effect' : task.kind === 'travel' ? 'validated_location_change' : task.completion_effect ?? 'record_activity_only',
      ...(activityResult ? { result: activityResult } : {}) };
  }
  task.updated_at = timestamp;
  task.revision += 1;
  task.history = task.history.slice(-100);
  if (task.kind === 'travel') reflectTravel(world, task);
  if (task.status !== 'running') settleProjectTask(world, task, timestamp);
  retainTasks(world);
  return { task_id: task.task_id, task: structuredClone(task), arrival_text: task.kind === 'travel' && task.status === 'completed' ? person.travel_state.arrival_text : null };
}

export function worldTaskReadModel(world, at) {
  const current = Date.parse(iso(at));
  return (world.tasks ?? []).map(task => ({
    ...structuredClone(task),
    remaining_seconds: task.status === 'running' ? Math.max(0, Math.ceil((Date.parse(task.due_at) - current) / 1000)) : task.status === 'paused' ? Math.ceil(task.remaining_ms / 1000) : 0,
  }));
}
