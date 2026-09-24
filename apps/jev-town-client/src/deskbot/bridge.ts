import type {
  DeskBotActionCandidate,
  DeskBotLifeWorld,
  DeskBotNpc,
  DeskBotWorldMap,
} from "./types.ts";

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function deskbotBaseUrl(): string {
  const query = new URLSearchParams(window.location.search).get("deskbotUrl");
  return cleanBaseUrl(query || import.meta.env.VITE_DESKBOT_URL || "http://127.0.0.1:4311");
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${cleanBaseUrl(baseUrl)}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`DeskBot ${path} returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function fetchDeskBotWorld(baseUrl = deskbotBaseUrl()): Promise<{
  map: DeskBotWorldMap;
  life: DeskBotLifeWorld;
}> {
  const [map, life] = await Promise.all([
    getJson<DeskBotWorldMap>(baseUrl, "/api/world/map"),
    getJson<DeskBotLifeWorld>(baseUrl, "/api/life/world"),
  ]);
  return { map, life };
}

export function buildNpcCandidates(map: DeskBotWorldMap, npc: DeskBotNpc): DeskBotActionCandidate[] {
  const location = map.locations.find((item) => item.location_id === npc.location_id);
  if (!location) return [];

  const observe: DeskBotActionCandidate = {
    id: `${map.world_revision}:${npc.npc_id}:observe`,
    npcId: npc.npc_id,
    npcName: npc.display_name,
    title: `留在${location.name}观察`,
    rationale: `不移动，只记录 ${npc.display_name} 在当前地点能看到的变化。`,
    actionName: "observe_current_location",
    status: `留在${location.name}观察周围变化`,
    fromLocationId: location.location_id,
    worldRevision: map.world_revision,
  };

  const moves = location.neighbors.flatMap((neighborId) => {
    const destination = map.locations.find((item) => item.location_id === neighborId);
    if (!destination) return [];
    return [{
      id: `${map.world_revision}:${npc.npc_id}:move:${neighborId}`,
      npcId: npc.npc_id,
      npcName: npc.display_name,
      title: `前往${destination.name}`,
      rationale: `${destination.name}与${location.name}直接相邻；这只是合法候选，还不是已经发生的事实。`,
      actionName: `travel_to_${neighborId}`,
      status: `正在前往${destination.name}`,
      fromLocationId: location.location_id,
      locationId: neighborId,
      worldRevision: map.world_revision,
    } satisfies DeskBotActionCandidate];
  });

  return [observe, ...moves];
}

export function validateCandidate(candidate: DeskBotActionCandidate, map: DeskBotWorldMap): string | null {
  if (candidate.worldRevision !== map.world_revision) return "世界已继续运行，请重新生成候选。";
  const npc = map.npcs.find((item) => item.npc_id === candidate.npcId);
  if (!npc) return "这个 NPC 已不在当前世界快照中。";
  if (npc.location_id !== candidate.fromLocationId) return "NPC 已经离开候选生成时的位置，请刷新。";
  if (!candidate.locationId) return null;
  const origin = map.locations.find((item) => item.location_id === npc.location_id);
  if (!origin?.neighbors.includes(candidate.locationId)) return "目标地点与 NPC 当前地点不相邻。";
  return null;
}

export async function executeCandidate(
  candidate: DeskBotActionCandidate,
  baseUrl = deskbotBaseUrl(),
  eventId = `jev-town-${crypto.randomUUID()}`,
): Promise<{ duplicate: boolean; map: DeskBotWorldMap }> {
  const latest = await getJson<DeskBotWorldMap>(baseUrl, "/api/world/map");
  const validationError = validateCandidate(candidate, latest);
  if (validationError) throw new Error(validationError);

  const response = await fetch(`${cleanBaseUrl(baseUrl)}/api/event`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: eventId,
      correlation_id: eventId,
      type: "world.mutation",
      source: "jev-town-deskbot-bridge",
      source_kind: "service",
      character_id: latest.protagonist.character_id,
      provenance: {
        interface: "jev-town-deskbot-bridge",
        candidate_id: candidate.id,
        expected_world_revision: candidate.worldRevision,
      },
      payload: {
        action: "npc_action",
        npc_id: candidate.npcId,
        action_name: candidate.actionName,
        status: candidate.status,
        ...(candidate.locationId ? { location_id: candidate.locationId } : {}),
      },
    }),
  });
  const body = await response.json() as { duplicate?: boolean; error?: string; message?: string };
  if (!response.ok) throw new Error(body.message || body.error || `DeskBot write returned HTTP ${response.status}`);
  return { duplicate: body.duplicate === true, map: await getJson<DeskBotWorldMap>(baseUrl, "/api/world/map") };
}
