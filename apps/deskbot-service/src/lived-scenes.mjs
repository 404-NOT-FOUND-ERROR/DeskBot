import { createHash } from 'node:crypto';
import { activeWorldTask } from './realtime-world.mjs';

export const LIVED_SCENE_VERSION = 'world-lived-scenes-v1';
const SLOT_MS = 30 * 60 * 1000;
const RESULT_WINDOW_MS = SLOT_MS;
const FAILURE_TEXT = Object.freeze({
  location_changed: '后来位置变了，这件事没能做完',
  passage_closed: '路口关了，这趟没能走到终点',
  route_changed: '原来的路不通了，这趟没能走到终点',
  activity_cancelled: '这件事中途停下了',
});
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 12);

function participantsAt(world, locationId) {
  return (world.npcs ?? []).filter(npc => npc.location_id === locationId
    && activeWorldTask(world, npc.npc_id)?.kind !== 'travel').map(npc => npc.npc_id).sort();
}

function terminalTime(task) {
  return task.completion?.due_at ?? task.finished_at;
}

function alreadyShown(world, task) {
  return (world.life?.recent_scenes ?? []).some(scene => scene.source_factors?.task?.task_id === task.task_id
    && scene.source_factors.task.status === task.status);
}

function recentResult(world, now, locationId, actorId = null) {
  return (world.tasks ?? []).filter(task => {
    if (!['completed', 'failed', 'cancelled'].includes(task.status) || (actorId && task.actor_id !== actorId)) return false;
    const actor = task.actor_id === world.protagonist.character_id ? world.protagonist
      : (world.npcs ?? []).find(npc => npc.npc_id === task.actor_id);
    const age = now.getTime() - Date.parse(terminalTime(task));
    return actor?.location_id === locationId && activeWorldTask(world, task.actor_id)?.kind !== 'travel'
      && (task.location_id ?? task.to_location_id) === locationId
      && age >= 0 && age < RESULT_WINDOW_MS && !alreadyShown(world, task);
  }).sort((a, b) => String(terminalTime(b)).localeCompare(String(terminalTime(a))))[0] ?? null;
}

// This is a presentation of existing tasks, never an action or resource writer.
export function selectLivedScene(world, now, { roleStages = [], timeBand = 'day', includeQuiet = true } = {}) {
  if (world.clock?.mode !== 'real_time') return null;
  const locationId = world.protagonist.location_id;
  const location = (world.locations ?? []).find(place => place.location_id === locationId);
  const participants = participantsAt(world, locationId);
  const ownTask = activeWorldTask(world, world.protagonist.character_id);
  if (ownTask?.kind === 'travel') return null;
  const nearbyTask = (world.tasks ?? []).filter(task => participants.includes(task.actor_id)
    && task.location_id === locationId && ['running', 'paused'].includes(task.status))
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
  const task = ownTask ?? recentResult(world, now, locationId, world.protagonist.character_id)
    ?? nearbyTask ?? recentResult(world, now, locationId);
  if (!task && !includeQuiet) return null;
  const slot = Math.floor(now.getTime() / SLOT_MS);
  const current = world.life?.current_scene;
  const localName = location?.name ?? '这里';
  let title, narration, opportunity, key, state;
  if (task) {
    const mine = task.actor_id === world.protagonist.character_id;
    const npc = (world.npcs ?? []).find(person => person.npc_id === task.actor_id);
    const name = mine ? '我' : npc?.display_name ?? '一位居民';
    const activity = task.title;
    state = task.status;
    key = `task:${task.task_id}:${state}:${task.revision ?? 0}`;
    if (state === 'running') {
      title = `${mine ? '喵呜' : name}在${localName}：${activity}`;
      narration = mine ? `我在${localName}忙着${activity}。还没做完呢，先陪我待一会儿？`
        : `我在${localName}。${name}正在${activity}，这会儿还没有做完。`;
      opportunity = mine ? '聊聊这次尝试，或等我做完再看结果' : `等${name}忙完，问问这件事`;
    } else if (state === 'paused') {
      title = `${mine ? '喵呜' : name}暂时停下了${activity}`;
      narration = `${mine ? '我把' : `${name}把`}${activity}暂时停下了。${mine ? '我还在' : '我们还在'}${localName}，这件事还没收尾。`;
      opportunity = '先歇一会儿，再决定要不要接着做';
    } else if (state === 'completed') {
      title = `${mine ? '喵呜' : name}做完了${activity}`;
      const result = task.completion?.result?.text;
      narration = mine ? `我${task.kind === 'travel' ? `到了${localName}` : `做完了${activity}`}。${result ?? ''}`
        : `${name}${task.kind === 'travel' ? `到了${localName}` : `做完了${activity}`}。${result ?? ''}`;
      opportunity = mine ? '聊聊这次经历，再看看接下来想做什么' : `问问${name}这次的经历`;
    } else {
      title = `${mine ? '喵呜' : name}的${activity}没能完成`;
      narration = `${mine ? '我' : name}这次没能完成${activity}。${FAILURE_TEXT[task.failure_code ?? task.failure_reason] ?? '这件事没有留下完成的结果'}。`;
      opportunity = '看看是什么绊住了这次尝试，或先换件事';
    }
  } else {
    // Catalog descriptions establish a place, not unexecuted NPC actions.
    key = `place:${locationId}:${world.logical_time?.date ?? world.logical_time?.day}:${timeBand}`;
    state = 'quiet';
    title = `喵呜在${localName}`;
    narration = `我在${localName}。${location?.description ?? ''}`;
    opportunity = participants.length ? '和这里的居民聊聊，或找一件想试的事' : '在这里待一会儿，看看想试什么';
  }
  const suffix = digest(`${key}:${participants.join(',')}:${roleStages.map(stage => stage.direction_id).sort().join(',')}`);
  const sameCurrent = current?.branch_key === key && current.location_id === locationId
    && JSON.stringify(current.participants) === JSON.stringify(participants);
  return {
    scene_id: `lived-scene:${slot}:${suffix}`, template_id: task ? `lived-task:${task.kind}:${state}` : `lived-place:${locationId}:${timeBand}`,
    content_version: LIVED_SCENE_VERSION, slot_key: String(slot), location_id: locationId,
    title, narration, sensory_cue: null, opportunity, time_band: timeBand, participants,
    branch_key: key, resolution_state: state, cause_event_ids: task?.cause_event_id ? [task.cause_event_id] : [], cause_experience_ids: [],
    source_factors: { logical_day: world.logical_time?.day, logical_minute: world.logical_time?.minute_of_day,
      role_stages: roleStages, ...(task ? { task: { task_id: task.task_id, actor_id: task.actor_id, activity_id: task.activity_id ?? null,
        status: task.status, revision: task.revision, cause_event_id: task.cause_event_id, result_at: terminalTime(task) ?? null,
        reconciliation_at: task.finished_at ?? null, completion: task.completion ?? null, failure_code: task.failure_code ?? task.failure_reason ?? null } } : {}) },
    continuity: { kind: sameCurrent ? 'continued' : task ? 'actual_task' : current?.location_id !== locationId ? 'arrival' : 'local_progression',
      previous_scene_id: current?.scene_id ?? null, previous_template_id: current?.template_id ?? null, previous_title: current?.title ?? null },
    started_at: sameCurrent ? current.started_at : now.toISOString(), expires_at: new Date((slot + 1) * SLOT_MS).toISOString(), npc_actions: {},
  };
}
