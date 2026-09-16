import { InputError } from './input-store.mjs';
import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';
import { previewWorldMutations } from './persistent-world.mjs';

const requireText = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new InputError(400, 'invalid_goal', 'Expected text up to 500 characters');
  return value.trim();
};

// Authored alternatives, state-based selection, one durable action per finite goal.
export function createNpcGoals({ persistence = null, now = () => new Date(), worldSnapshot, ingest, reserved = () => false }) {
  const goals = new Map((persistence?.list('life.npc-goals') ?? []).map(g => [g.id, g]));
  function save(goal) { persistence?.put('life.npc-goals', goal.id, goal); goals.set(goal.id, goal); return structuredClone(goal); }
  function add(body) {
    const id = requireText(body.id);
    const npcId = requireText(body.npc_id);
    if (goals.has(id)) throw new InputError(409, 'goal_exists', 'Goal ID already exists');
    if (reserved(npcId) || [...goals.values()].some(g => g.npc_id === npcId && ['active', 'paused', 'failed'].includes(g.state))) {
      throw new InputError(409, 'npc_reserved', 'NPC already has an unfinished plan or goal');
    }
    if (!Array.isArray(body.options) || !body.options.length || body.options.length > 5) throw new InputError(400, 'invalid_goal', 'Provide 1 to 5 ordered alternatives');
    const options = body.options.map(option => {
      if (!option || !['event_present', 'npc_status'].includes(option.when?.kind)) throw new InputError(400, 'invalid_goal', 'Unsupported world condition');
      const when = { kind: option.when.kind, value: requireText(option.when.value) };
      const payload = { action: 'npc_action', npc_id: npcId, action_name: requireText(option.action_name), status: requireText(option.status) };
      previewWorldMutations(worldSnapshot(), [payload]);
      return { when, payload };
    });
    return save({ id, npc_id: npcId, purpose: requireText(body.purpose), options, state: 'active', created_at: now().toISOString(), decision: null });
  }
  function control(id, operation) {
    const current = goals.get(id);
    if (!current) throw new InputError(404, 'goal_not_found', 'Goal not found');
    if (!['pause', 'resume', 'cancel'].includes(operation)) throw new InputError(400, 'invalid_goal_operation', 'Invalid goal operation');
    if (['completed', 'cancelled'].includes(current.state) || (operation !== 'cancel' && current.state === 'failed')) throw new InputError(409, 'goal_terminal', 'Create a new goal after cancelling failed goals');
    return save({ ...current, state: { pause: 'paused', resume: 'active', cancel: 'cancelled' }[operation] });
  }
  function tick() {
    for (const original of goals.values()) {
      if (original.state !== 'active') continue;
      const goal = structuredClone(original);
      if (!goal.decision) {
        if (reserved(goal.npc_id)) continue;
        const world = worldSnapshot();
        const index = goal.options.findIndex(option => option.when.kind === 'event_present'
          ? world.world_line.recent_events.some(e => e.event_id === option.when.value)
          : world.npcs.some(n => n.npc_id === goal.npc_id && n.status === option.when.value));
        if (index < 0) continue;
        const chosen = goal.options[index];
        const timestamp = now().toISOString();
        goal.decision = { option_index: index, condition: chosen.when, world_revision: world.world_revision,
          event: { event_id: `npc-goal:${goal.id}`, type: 'world.mutation', source: 'npc-goal-engine', source_kind: 'world_engine',
            layer: 'world_line', character_id: DEFAULT_CHARACTER_ID, occurred_at: timestamp, observed_at: timestamp,
            payload: { ...chosen.payload, occurred_at: timestamp } } };
        // Persist the exact command before delivery so restart replays the same event.
        save(goal);
      }
      try { ingest(goal.decision.event); goal.state = 'completed'; goal.completed_at = now().toISOString(); }
      catch (error) { goal.state = 'failed'; goal.error = error.code ?? 'npc_action_failed'; }
      save(goal);
    }
  }
  return { add, control, tick, list: () => structuredClone([...goals.values()]),
    reserved: npcId => [...goals.values()].some(g => g.npc_id === npcId && ['active', 'paused', 'failed'].includes(g.state)) };
}
