import type { DeskBotLifeWorld, DeskBotWorldMap } from "./types.ts";

/**
 * Small lifecycle gate for overlapping read-model refreshes. It mirrors the
 * world renderer's revision gate without coupling the feed to React: only the
 * latest mounted generation may publish a response.
 */
export interface RefreshGenerationGate {
  activate(): void;
  begin(): number;
  isCurrent(generation: number): boolean;
  invalidate(): void;
  run(read: (commit: (write: () => void) => boolean) => Promise<void>, failed: (error: unknown) => void): Promise<void>;
}

export function createRefreshGenerationGate(): RefreshGenerationGate {
  let current = 0;
  let mounted = true;
  const gate: RefreshGenerationGate = {
    activate: () => { mounted = true; current += 1; },
    begin: () => ++current,
    isCurrent: (generation: number) => mounted && generation === current,
    invalidate: () => { mounted = false; current += 1; },
    async run(read, failed) {
      const generation = gate.begin();
      try {
        await read(write => {
          if (!gate.isCurrent(generation)) return false;
          write();
          return true;
        });
      } catch (error) {
        if (gate.isCurrent(generation)) failed(error);
      }
    },
  };
  return gate;
}

/** A user-facing event in the shared-life timeline. Backend provenance stays
 * out of the read model except for the opaque sequence needed to preserve
 * canonical story order; the main world view is not a debug console. */
export interface DeskBotLifeFeedEvent {
  id: string;
  at: string;
  /** Canonical mutation sequence, when the service provides it.  This is the
   * ordering key used by the world ledger; timestamps remain a compatibility
   * fallback for older services. */
  sequence?: number;
  /** Order inside one canonical commit; entry cursors must retain it. */
  itemIndex?: number;
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
    .sort(compareFeedEvents)
    .slice(0, Math.max(1, limit));
}

/**
 * Asamana's narrative feed is ordered by the runtime's emission sequence,
 * rather than by wall-clock time.  DeskBot's canonical feed now exposes the
 * same sequence through provenance.  Keep newest-first for the current UI,
 * but make ordering deterministic when several mutations share a timestamp
 * (or when a clock is replayed).
 */
function compareFeedEvents(a: DeskBotLifeFeedEvent, b: DeskBotLifeFeedEvent): number {
  const aSequence = Number.isSafeInteger(a.sequence) ? a.sequence! : null;
  const bSequence = Number.isSafeInteger(b.sequence) ? b.sequence! : null;
  if (aSequence !== null && bSequence !== null && aSequence !== bSequence) return bSequence - aSequence;
  if (aSequence !== null && bSequence !== null && Number.isSafeInteger(a.itemIndex) && Number.isSafeInteger(b.itemIndex)
    && a.itemIndex !== b.itemIndex) return b.itemIndex! - a.itemIndex!;
  if (aSequence !== null && bSequence === null) return -1;
  if (aSequence === null && bSequence !== null) return 1;
  const at = Date.parse(a.at);
  const bt = Date.parse(b.at);
  return bt - at || a.id.localeCompare(b.id);
}

/** The canonical feed endpoint is introduced by the service independently of
 * this client. Keep the old path as a compatibility fallback for an older
 * local service during staged rollout. */
export async function fetchPersistentLifeFeed(baseUrl: string, limit = 12): Promise<DeskBotLifeFeedEvent[] | null> {
  const root = baseUrl.replace(/\/+$/, "");
  try {
    const response = await fetch(`${root}/api/life/world/feed?limit=${limit}`, {cache: "no-store"});
    if (!response.ok) return null;
    return readPersistentLifeFeed(await response.json(), limit);
  } catch { /* service may be restarting or endpoint may not exist yet */ }
  return null;
}

/** Both standalone and unified snapshots use the same canonical feed view. */
export function readPersistentLifeFeed(input: unknown, limit = 12): DeskBotLifeFeedEvent[] | null {
    if (!input || typeof input !== 'object') return null;
    const body = input as {schema?: unknown;entries?: unknown[]};
    if (body.schema !== "deskbot.world-life-feed-response.v1" || !Array.isArray(body.entries)) return null;
    const events: DeskBotLifeFeedEvent[] = [];
    for (const event of body.entries) {
      if (!event || typeof event !== 'object') continue;
      const value = event as {id?: unknown;at?: unknown;kind?: unknown;title?: unknown;text?: unknown;location_id?: unknown;actor_id?: unknown;actor_name?: unknown;provenance?: unknown};
      if (typeof value.id !== "string" || !validAt(value.at) || typeof value.title !== "string" || typeof value.text !== "string") continue;
      const provenance = value.provenance as {sequence?: unknown;item_index?: unknown} | undefined;
      const sequence = typeof provenance?.sequence === "number" && Number.isSafeInteger(provenance.sequence)
        ? provenance.sequence
        : undefined;
      events.push({id:value.id,at:value.at,kind:typeof value.kind === "string" ? value.kind : "world",title:value.title,text:value.text,
        ...(sequence === undefined ? {} : {sequence}),
        ...(typeof provenance?.item_index === 'number' && Number.isSafeInteger(provenance.item_index) && provenance.item_index >= 0 ? {itemIndex:provenance.item_index} : {}),
        ...(typeof value.location_id === "string" ? {locationId:value.location_id} : {}),
        ...(typeof value.actor_id === "string" ? {actorId:value.actor_id} : {}),
        ...(typeof value.actor_name === "string" ? {actorName:value.actor_name} : {})});
    }
    return events.sort(compareFeedEvents).slice(0, limit);
}
