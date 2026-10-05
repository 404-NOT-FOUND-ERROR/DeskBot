export const AUTONOMY_VERSION = 'morrowmere-autonomous-life-v1';
const clamp = value => Math.max(0, Math.min(1, value));
export function installAutonomy(world, at) {
  const fresh = !world.autonomy;
  world.autonomy ??= { schema: AUTONOMY_VERSION, enabled: true, installed_at: at, revision: 0, actors: {}, recent: [] };
  for (const person of [world.protagonist, ...world.npcs]) {
    const id = person.character_id ?? person.npc_id;
    world.autonomy.actors[id] ??= { actor_id: id, energy: .78, appetite: .35, updated_at: at, sequence: 0,
      paused: false, next_decision_at: at, cooldowns: {}, plan: null, last_feedback: null, last_candidates: [] };
  }
  return fresh;
}
export function syncLifeNeeds(world, at) {
  for (const state of Object.values(world.autonomy?.actors ?? {})) {
    const hours = (Date.parse(at) - Date.parse(state.updated_at)) / 3600000;
    if (!(hours > 0)) continue;
    const resting = world.tasks?.some(t => t.actor_id === state.actor_id && t.status === 'running' && t.life_action === 'rest');
    state.energy = clamp(state.energy + hours * (resting ? .22 : -.025));
    state.appetite = clamp(state.appetite + hours * .025);
    state.updated_at = at;
  }
}
export function finishLifeTask(world, task, at) {
  const state = world.autonomy?.actors[task.actor_id];
  if (!state || task.status !== 'completed') return;
  if (task.activity_id === 'share-meal') state.appetite = clamp(state.appetite - .65);
  if (task.life_action !== 'rest') state.energy = clamp(state.energy - (task.kind === 'travel' ? .025 : task.kind === 'craft' ? .06 : .025));
  state.updated_at = at;
}
export function lifeNote(world, at, actorId, kind, text, more = {}) {
  world.autonomy.recent.push({ at, actor_id: actorId, kind, text, ...more });
  world.autonomy.recent = world.autonomy.recent.slice(-80);
}
