import type { DeskBotWorldMap, DeskBotLifeWorld, DeskBotRoleWishSnapshot } from './types.ts';

export interface RuntimeActor {
  actor_id: string; display_name: string;
  scheduler: 'continuous_cognition' | 'committed_plan' | 'autonomous_life' | 'legacy_routine' | 'manual';
  decision_mode: string; status: string; task_ids: string[];
  next_decision_at: string | null; awaiting_meal: boolean; conflicts: string[]; wait_reason?:string|null;
}
export interface WorldSnapshot {
  schema: 'deskbot.world-observer-snapshot.v1'; world_id: string; world_revision: number;
  sequence: number; instance_id: string; capture: number; snapshot_id: string; captured_at: string;
  map: DeskBotWorldMap; life: DeskBotLifeWorld;
  role_wishes: DeskBotRoleWishSnapshot & {world_id: string; world_revision: number};
  runtime: { schema: 'deskbot.world-runtime.v1'; world_id: string; world_revision: number; scope: 'live' | 'lab';
    continuous_cognition_count: number; model_configured: boolean; cognitive_worker_running: boolean;
    meal_supply?:{available_portions:number;potential_portions:number;uncovered_needs:number;commitments:{actor_id:string;stage:string;potential_portions:number;ingredient_units:number}[]};
    meal_wait_count: number; actors: RuntimeActor[];
    facilities: {object_id: string; name: string; tasks: {task_id: string; actor_id: string; title: string; status: string; due_at: string | null}[]}[];
  };
}
export type ObserverState = { snapshot: WorldSnapshot | null; status: 'connecting' | 'connected' | 'stale'; error: string | null };

export function validateWorldSnapshot(value: unknown): WorldSnapshot {
  const s = value as WorldSnapshot;
  if (!s || s.schema !== 'deskbot.world-observer-snapshot.v1' || !s.world_id || !s.instance_id || !s.snapshot_id
    || !Number.isSafeInteger(s.sequence) || s.sequence < 0 || !Number.isSafeInteger(s.world_revision) || s.world_revision < 0
    || !Number.isSafeInteger(s.capture) || s.capture < 1 || !Number.isFinite(Date.parse(s.captured_at))
    || s.map?.schema !== 'deskbot.world-map.v0.1' || s.life?.schema !== 'deskbot.world-life.v0.3'
    || !s.role_wishes?.evolution || !Array.isArray(s.role_wishes?.proposals) || s.runtime?.schema !== 'deskbot.world-runtime.v1'
    || !Array.isArray(s.runtime?.actors) || !Array.isArray(s.runtime?.facilities)
    || [s.map, s.life, s.role_wishes, s.runtime].some(v => v.world_revision !== s.world_revision)
    || [s.map, s.role_wishes, s.runtime].some(v => v.world_id !== s.world_id)) {
    throw Error('收到的世界快照不完整或版本不一致，保留上次画面。');
  }
  return s;
}

export async function fetchWorldSnapshot(baseUrl: string, signal?: AbortSignal): Promise<WorldSnapshot> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/world/snapshot`, { cache: 'no-store', signal });
  if (!response.ok) throw Error(`近况暂时无法读取（HTTP ${response.status}）`);
  return validateWorldSnapshot(await response.json());
}

// One gate for the entire world view, not separate gates for map/life/roles.
// Request order protects process restarts; ledger/capture order protects delayed
// replies. A restored older save requires an explicit page reload to accept.
export function createWorldObserverClient({ read, onChange, timeoutMs = 10000 }: {
  read: (signal: AbortSignal) => Promise<WorldSnapshot>; onChange: (state: ObserverState) => void; timeoutMs?: number;
}) {
  let state: ObserverState = { snapshot: null, status: 'connecting', error: null };
  let requestId = 0, lastPublished = 0, stopped = false;
  const controllers = new Set<AbortController>();
  const publish = (next: ObserverState) => { state = next; onChange(state); };
  async function refresh() {
    if (stopped) return null;
    const id = ++requestId, controller = new AbortController(); controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const next = validateWorldSnapshot(await Promise.race([read(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error('连接超时，保留最后画面；恢复连接后会自动更新。')); }, timeoutMs);
      })]));
      if (stopped || id < lastPublished) return state.snapshot;
      const current = state.snapshot;
      if (current && current.world_id !== next.world_id) throw Error('连接到了另一份世界，请核对服务地址后重新打开页面。');
      if (current && (next.sequence < current.sequence || next.world_revision < current.world_revision)) throw Error('服务返回了较早的存档，画面没有回退；确认恢复操作后可重新打开页面。');
      if (current?.instance_id === next.instance_id && next.capture < current.capture) return current;
      lastPublished = id;
      publish({ snapshot: next, status: 'connected', error: null });
      return next;
    } catch (error) {
      if (!stopped && id >= lastPublished) {
        lastPublished = id;
        publish({ ...state, status: 'stale', error: error instanceof Error ? error.message : '连接暂时中断，保留最后画面。' });
      }
      return null;
    } finally { clearTimeout(timer); controllers.delete(controller); }
  }
  return { refresh, getState: () => state, stop() { stopped = true; controllers.forEach(c => c.abort()); controllers.clear(); } };
}
