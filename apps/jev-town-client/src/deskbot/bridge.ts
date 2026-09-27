import type {
  DeskBotActionCandidate,
  DeskBotLifeWorld,
  DeskBotNpc,
  DeskBotNpcInteractionRequest,
  DeskBotNpcInteractionResponse,
  DeskBotChatResult,
  DeskBotWorldTravelResponse,
  DeskBotWorldRouteResponse,
  DeskBotWorldMap,
  DeskBotPresentationPoint,
} from "./types.ts";

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

class DeskBotHttpError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeskBotHttpError";
    this.code = code;
  }
}

export function deskbotBaseUrl(): string {
  const query = new URLSearchParams(window.location.search).get("deskbotUrl");
  return cleanBaseUrl(query || import.meta.env.VITE_DESKBOT_URL || "http://127.0.0.1:4311");
}

async function getJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${cleanBaseUrl(baseUrl)}${path}`, { cache: "no-store" });
  return responseJson<T>(response, `DeskBot ${path} returned HTTP ${response.status}`);
}

export async function fetchWorldRoute(
  destinationLocationId: string,
  baseUrl = deskbotBaseUrl(),
): Promise<DeskBotWorldRouteResponse> {
  const query = new URLSearchParams({ destination_location_id: destinationLocationId });
  return getJson<DeskBotWorldRouteResponse>(baseUrl, `/api/world/route?${query.toString()}`);
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (!response.ok) throw new DeskBotHttpError(body?.error || "http_error", body?.message || body?.error || fallback);
  if (body === null) throw new Error("DeskBot 返回了无法解析的响应。");
  return body as T;
}

async function postJson<T>(baseUrl: string, path: string, payload: unknown, fallback: string): Promise<T> {
  const response = await fetch(`${cleanBaseUrl(baseUrl)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return responseJson<T>(response, fallback);
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

export async function interactWithNpc(
  request: DeskBotNpcInteractionRequest,
  baseUrl = deskbotBaseUrl(),
): Promise<DeskBotNpcInteractionResponse> {
  const idea = request.idea?.trim();
  const interactionId = request.interactionId || `jev-town-interaction-${crypto.randomUUID()}`;
  return postJson<DeskBotNpcInteractionResponse>(baseUrl, "/api/life/npc-interactions", {
      interaction_id: interactionId,
      npc_id: request.npcId,
      intent: request.intent,
      ...(idea ? { idea } : {}),
      source: "jev-town-world-client",
  }, "DeskBot NPC interaction failed");
}

export async function sendChat(
  request: { eventId: string; characterId: string; message: string },
  baseUrl = deskbotBaseUrl(),
): Promise<DeskBotChatResult> {
  const payload = await postJson<{
    turn?: {
      reply?: string;
      reply_event?: { payload?: { text?: string } };
      expression_intent?: { mode?: string; pace?: string };
      state?: { interaction?: { expression_intent?: { mode?: string; pace?: string } } };
    };
    reply?: string;
    reply_event?: { payload?: { text?: string } };
    expression_intent?: { mode?: string; pace?: string };
    state?: { interaction?: { expression_intent?: { mode?: string; pace?: string } } };
  }>(baseUrl, "/api/chat", {
    event_id: request.eventId,
    character_id: request.characterId,
    source: "jev-town-world-client",
    message: request.message,
  }, "DeskBot chat failed");
  const turn = payload.turn ?? payload;
  const reply = turn.reply?.trim() || turn.reply_event?.payload?.text?.trim();
  if (!reply) throw new Error("DeskBot 没有返回可显示的回复。");
  const expressionIntent = turn.expression_intent ?? turn.state?.interaction?.expression_intent;
  return { reply, ...(expressionIntent ? { expressionIntent } : {}) };
}

export async function travelToLocation(
  request: { locationId: string; eventId: string; reason?: string; expectedWorldRevision?: number; expectedFromLocationId?: string },
  baseUrl = deskbotBaseUrl(),
): Promise<DeskBotWorldTravelResponse> {
  const latest = await getJson<DeskBotWorldMap>(baseUrl, "/api/world/map");
  const destination = latest.locations.find((location) => location.location_id === request.locationId);
  if (!destination) throw new Error("这个地点已不在最新世界地图中，请重新选择。");
  if (destination.current) throw new Error("喵呜已经在这里了。");
  if (request.expectedWorldRevision !== undefined && latest.world_revision !== request.expectedWorldRevision) {
    throw new DeskBotHttpError("world_revision_changed", "世界状态刚刚改变，正在重新规划路线。");
  }
  if (request.expectedFromLocationId !== undefined) {
    const origin = latest.locations.find((location) => location.location_id === request.expectedFromLocationId);
    if (latest.protagonist.location_id !== request.expectedFromLocationId) {
      throw new DeskBotHttpError("world_location_changed", "喵呜的位置刚刚改变，正在重新规划路线。");
    }
    if (!origin?.neighbors.includes(destination.location_id)) {
      throw new DeskBotHttpError("route_step_changed", "这一步已经不再是当前地点的相邻路线，请重新规划。");
    }
  } else if (!destination.reachable) {
    throw new Error("这个地点目前不可直达，请先前往相邻地点。");
  }

  const result = await postJson<DeskBotWorldTravelResponse>(baseUrl, "/api/world/travel", {
    event_id: request.eventId,
    character_id: latest.protagonist.character_id,
    location_id: destination.location_id,
    reason: request.reason ?? `从地图确认前往${destination.name}`,
    ...(request.expectedWorldRevision !== undefined ? { expected_world_revision: request.expectedWorldRevision } : {}),
    ...(request.expectedFromLocationId !== undefined ? { expected_from_location_id: request.expectedFromLocationId } : {}),
    source: "jev-town-world-client",
  }, "DeskBot travel failed");
  if (!result.accepted && !result.duplicate) throw new Error("DeskBot 世界没有接受这次旅行。");
  return result;
}

/**
 * Walk a canonical route one hop at a time.  Route and map are re-read before
 * every mutation, so a world revision or an event changing adjacency pauses
 * the walk instead of allowing the browser to move the protagonist locally.
 */
export async function travelRouteToLocation(
  request: { destinationLocationId: string; eventIdPrefix?: string; reason?: string },
  baseUrl = deskbotBaseUrl(),
  onStep?: (state: {
    step: number;
    total: number;
    destinationName: string;
    fromLocationId: string;
    toLocationId: string;
    travelCostMinutes: number;
    presentationSpace?: string;
    presentationPoints?: DeskBotPresentationPoint[];
    map: DeskBotWorldMap;
  }) => unknown | PromiseLike<unknown>,
): Promise<{ map: DeskBotWorldMap; route: DeskBotWorldRouteResponse["route"]; completed: boolean; stepsCompleted: number }> {
  let completed = 0;
  // Re-planning after every canonical hop must not change the progress
  // denominator shown to the user for the current trip.
  let plannedTotal: number | null = null;
  let finalRoute: DeskBotWorldRouteResponse["route"] | null = null;
  let latestMap: DeskBotWorldMap | null = null;
  while (true) {
    const routeResponse = await fetchWorldRoute(request.destinationLocationId, baseUrl);
    finalRoute = routeResponse.route;
    latestMap = routeResponse.map;
    if (routeResponse.world_revision !== latestMap.world_revision
      || routeResponse.route.world_revision !== latestMap.world_revision
      || routeResponse.route.current_location_id !== latestMap.protagonist.location_id) {
      throw new Error("世界状态刚刚改变，路线已暂停；请重新规划。 ");
    }
    if (plannedTotal === null) plannedTotal = routeResponse.route.steps.length;
    if (routeResponse.route.blocked) {
      throw new Error(routeResponse.route.blocked_reason || "当前世界事件暂时阻断旅行。 ");
    }
    if (!routeResponse.route.found) throw new Error("当前世界没有可行路线，请稍后重新规划。 ");
    const next = routeResponse.route.steps[0];
    if (!next) {
      return { map: latestMap, route: finalRoute, completed: true, stepsCompleted: completed };
    }
    const origin = latestMap.locations.find((location) => location.location_id === next.from_location_id);
    const destination = latestMap.locations.find((location) => location.location_id === next.to_location_id);
    if (next.from_location_id !== latestMap.protagonist.location_id
      || !origin?.neighbors.includes(next.to_location_id)
      || !destination) {
      throw new Error("路线与最新地图不一致，旅行已暂停；请重新规划。 ");
    }
    if (latestMap.active_event?.blocks_travel) {
      throw new Error(`事件阻断：${latestMap.active_event.title || latestMap.active_event.event_id || "道路暂不可通行"}`);
    }
    const stepEventId = `${request.eventIdPrefix || "jev-town-route"}-${next.from_location_id}-${next.to_location_id}`;
    try {
      const result = await travelToLocation({
        locationId: next.to_location_id,
        eventId: stepEventId,
        reason: request.reason || `沿路线前往${routeResponse.route.destination_location_id}`,
        expectedWorldRevision: routeResponse.world_revision,
        expectedFromLocationId: next.from_location_id,
      }, baseUrl);
      latestMap = result.map;
      completed += 1;
      await onStep?.({
        step: completed,
        total: plannedTotal,
        destinationName: next.to_name,
        fromLocationId: next.from_location_id,
        toLocationId: next.to_location_id,
        travelCostMinutes: next.travel_cost_minutes,
        presentationSpace: next.presentation_space,
        presentationPoints: next.presentation_points,
        map: latestMap,
      });
    } catch (error) {
      if (error instanceof DeskBotHttpError && ["world_revision_changed", "world_location_changed"].includes(error.code)) {
        throw new Error(`${error.message}旅行已暂停。`);
      }
      throw error;
    }
    if (completed >= 50) throw new Error("路线已行进 50 段仍未抵达，旅行已暂停以避免无限绕行。 ");
  }
}
