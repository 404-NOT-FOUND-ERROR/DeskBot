import type { Point } from "@shared/positions.ts";
import { canonicalRouteBetween } from "./canonicalGeometry.ts";
import type { DeskBotWorldMap } from "./types.ts";

/** A read-only presentation of an admitted task. Animation never settles it. */
export interface SceneLifeActivity {
  actorId: string;
  citizenId: number;
  locationId: string;
  taskId: string;
  title: string;
  kind: string;
  lifeAction?: string;
  activityId?: string;
  targetObjectId?: string;
  status: "running" | "paused";
  startedAt?: string;
  dueAt: string;
  durationMs?: number;
  remainingMs: number;
  fromLocationId?: string;
  toLocationId?: string;
  route?: Point[];
  projectedAt?: string;
  realTime?: boolean;
  /** Actual carried inventory from this same snapshot, never a recipe's future output. */
  carriedStock?: Readonly<Record<string, number>>;
}

export function sceneCitizenId(actorId: string, isProtagonist = false): number {
  let hash = 2166136261;
  for (const char of actorId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Math.abs(hash % 100000) + 1000 + (isProtagonist ? 500000 : 0);
}

export function projectSceneActivities(map: DeskBotWorldMap | null | undefined): SceneLifeActivity[] {
  if (!map) return [];
  const locations = new Map(map.locations.map((location) => [location.location_id, location]));
  const actorLocations = new Map(map.npcs.map((npc) => [npc.npc_id, npc.location_id]));
  actorLocations.set(map.protagonist.character_id, map.protagonist.location_id);
  return (map.tasks ?? []).filter((task) => task.status === "running" || task.status === "paused")
    .filter((task) => actorLocations.has(task.actor_id))
    .map((task): SceneLifeActivity => {
      const from = locations.get(task.from_location_id ?? "");
      const to = locations.get(task.to_location_id ?? "");
      return {
        actorId: task.actor_id,
        citizenId: sceneCitizenId(task.actor_id, task.actor_id === map.protagonist.character_id),
        locationId: task.location_id ?? actorLocations.get(task.actor_id)!,
        taskId: task.task_id,
        title: task.title,
        kind: task.kind === "travel" ? "travel" : task.activity_id === "share-meal" ? "eat" : ["rest","eat","observe","social","care","craft"].includes(task.life_action ?? "") ? task.life_action! : task.kind,
        lifeAction: task.life_action,
        activityId: task.activity_id,
        targetObjectId: task.target_object_id,
        status: task.status as "running" | "paused",
        startedAt: task.segment_started_at ?? task.started_at,
        dueAt: task.due_at,
        durationMs: task.duration_ms,
        remainingMs: task.remaining_ms,
        fromLocationId: task.from_location_id,
        toLocationId: task.to_location_id,
        route: task.kind === "travel" && from && to ? canonicalRouteBetween(from, to) : undefined,
        projectedAt: map.environment?.projected_at,
        realTime: map.environment?.time.mode === "real_time",
        carriedStock: { ...(task.actor_id === map.protagonist.character_id
          ? map.living?.inventory.stock
          : map.autonomy?.actors.find(actor => actor.actor_id === task.actor_id)?.inventory) },
      };
    });
}

export function activityProgressAt(activity: SceneLifeActivity, now = Date.now()): number {
  const end = Date.parse(activity.dueAt);
  const start = Date.parse(activity.startedAt ?? "");
  const duration = activity.durationMs ?? (Number.isFinite(start) && Number.isFinite(end) ? end - start : 0);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const clock = activity.realTime ? now : Date.parse(activity.projectedAt ?? activity.startedAt ?? "");
  const remaining = activity.status === "paused" || !Number.isFinite(clock) || !Number.isFinite(end)
    ? activity.remainingMs : Math.max(0, end - clock);
  // Only the service can confirm arrival. A late response cannot finish a task in the browser.
  return Math.min(0.995, Math.max(0, 1 - remaining / duration));
}
