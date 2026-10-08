import type { DeskBotLifeWorld, DeskBotWorldMap } from "./types.ts";

/** A user-facing event in the shared-life timeline. Backend provenance is kept
 * out of this read model so the main world view remains a story, not a debug
 * console. */
export interface DeskBotLifeFeedEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  text: string;
  locationId?: string;
  actorId?: string;
  actorName?: string;
}

const validAt = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const actorName = (map: DeskBotWorldMap, id?: string | null) => id === map.protagonist.character_id
  ? "喵呜"
  : map.npcs.find(value => value.npc_id === id)?.display_name ?? "镇上的居民";

function sceneEvents(life: DeskBotLifeWorld): DeskBotLifeFeedEvent[] {
  const scenes = [...(life.recent_scenes ?? []), life.current_scene].filter(Boolean) as NonNullable<DeskBotLifeWorld["current_scene"]>[];
  return scenes.map(scene => ({
    id: `scene:${scene.scene_id}`,
    at: scene.started_at,
    kind: "scene" as const,
    title: scene.title,
    text: scene.narration,
    locationId: scene.location_id,
  }));
}

function npcEvents(map: DeskBotWorldMap): DeskBotLifeFeedEvent[] {
  return (map.autonomy?.recent ?? []).filter(value => validAt(value.at)).map(value => ({
    id: `npc:${value.at}:${value.actor_id}:${value.kind}:${value.task_id ?? ""}`,
    at: value.at,
    kind: "npc" as const,
    title: actorName(map, value.actor_id),
    text: value.text,
    actorId: value.actor_id,
    actorName: actorName(map, value.actor_id),
  }));
}

function memoryEvents(map: DeskBotWorldMap, life: DeskBotLifeWorld): DeskBotLifeFeedEvent[] {
  return (life.recent_experiences ?? []).filter(value => validAt(value.occurred_at)).map(value => ({
    id: `memory:${value.experience_id}`,
    at: value.occurred_at,
    kind: "memory" as const,
    title: value.npc_name ? `喵呜和${value.npc_name}有了新的共同经历` : "一段共同经历留下来了",
    text: value.summary,
    locationId: value.location_id,
    actorId: value.npc_id,
    actorName: value.npc_name ?? actorName(map, value.npc_id),
  }));
}

/** Compatibility for a service predating the ledger feed: only use already
 * persisted read-model records, never invent completed work or memories. */
export function buildLifeFeed(map: DeskBotWorldMap, life: DeskBotLifeWorld, limit = 12): DeskBotLifeFeedEvent[] {
  const events = [...sceneEvents(life), ...npcEvents(map), ...memoryEvents(map, life)];
  const unique = new Map<string, DeskBotLifeFeedEvent>();
  for (const event of events) if (!unique.has(event.id)) unique.set(event.id, event);
  return [...unique.values()]
    .filter(event => validAt(event.at))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.max(1, limit));
}

/** The canonical feed endpoint is introduced by the service independently of
 * this client. Keep the old path as a compatibility fallback for an older
 * local service during staged rollout. */
export async function fetchPersistentLifeFeed(baseUrl: string, limit = 12): Promise<DeskBotLifeFeedEvent[] | null> {
  const root = baseUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${root}/api/life/world/feed?limit=${limit}`, {cache: "no-store"});
    if (!response.ok) return null;
    const body = await response.json() as {schema?: unknown;entries?: unknown[]};
    if (body.schema !== "deskbot.world-life-feed-response.v1") return null;
    const events: DeskBotLifeFeedEvent[] = [];
    for (const event of body.entries ?? []) {
      const value = event as {id?: unknown;at?: unknown;kind?: unknown;title?: unknown;text?: unknown;location_id?: unknown;actor_id?: unknown;actor_name?: unknown};
      if (typeof value.id !== "string" || !validAt(value.at) || typeof value.title !== "string" || typeof value.text !== "string") continue;
      events.push({id:value.id,at:value.at,kind:typeof value.kind === "string" ? value.kind : "world",title:value.title,text:value.text,
        ...(typeof value.location_id === "string" ? {locationId:value.location_id} : {}),
        ...(typeof value.actor_id === "string" ? {actorId:value.actor_id} : {}),
        ...(typeof value.actor_name === "string" ? {actorName:value.actor_name} : {})});
    }
    return events.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0, limit);
  } catch { /* service may be restarting or endpoint may not exist yet */ }
  return null;
}
