import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNpcCandidates, fetchWorldRoute, interactWithNpc, sendChat, travelRouteToLocation, travelToLocation, validateCandidate } from "../src/deskbot/bridge.ts";
import type { DeskBotLifeWorld, DeskBotNpcInteractionResponse, DeskBotWorldMap, DeskBotWorldRouteResponse, DeskBotWorldTravelResponse } from "../src/deskbot/types.ts";

const map: DeskBotWorldMap = {
  schema: "deskbot.world-map.v0.1",
  world_id: "test",
  world_revision: 8,
  logical_time: { day: 1, minute_of_day: 480, tick: 8 },
  protagonist: { character_id: "shaping-001", location_id: "desk" },
  locations: [
    { location_id: "desk", name: "桌边", description: "", x: 10, y: 10, neighbors: ["road"], current: true, reachable: false, arrival_text: "" },
    { location_id: "road", name: "旧路", description: "", x: 20, y: 20, neighbors: ["desk"], current: false, reachable: true, arrival_text: "" },
    { location_id: "lake", name: "水岸", description: "", x: 30, y: 30, neighbors: [], current: false, reachable: false, arrival_text: "" },
  ],
  npcs: [{ npc_id: "npc-1", display_name: "巡路员", role: "keeper", location_id: "desk", status: "观察", bio: "", temperament: "", speech_style: "", last_action: null }],
};

const life: DeskBotLifeWorld = {
  schema: "deskbot.world-life.v0.3",
  enabled: true,
  world_revision: 9,
  current_location_id: "desk",
  current_scene: null,
  recent_scenes: [],
  recent_experiences: [],
  encounters: [{ ...map.npcs[0]!, relationship: { familiarity: 3, trust: 1, encounters: 1 } }],
  available_interactions: ["observe", "greet", "chat", "suggest", "help", "invite"],
};

const interaction: DeskBotNpcInteractionResponse = {
  schema: "deskbot.npc-interaction-response.v0.2",
  accepted: true,
  duplicate: false,
  interaction_id: "stable-001",
  response: "先看脚下，再决定往哪里走。",
  experience: {
    experience_id: "stable-001",
    kind: "npc_interaction",
    npc_id: "npc-1",
    npc_name: "巡路员",
    scene_id: null,
    location_id: "desk",
    intent: "suggest",
    summary: "在桌边与巡路员交换想法",
    occurred_at: "2026-09-24T03:00:00.000Z",
    role_direction: null,
  },
  role_evidence: null,
  npc: life.encounters[0]!,
  life,
};

afterEach(() => vi.unstubAllGlobals());

describe("DeskBot bridge candidate boundary", () => {
  it("only offers stay plus adjacent moves", () => {
    const npc = map.npcs[0];
    expect(npc).toBeDefined();
    const candidates = buildNpcCandidates(map, npc!);
    expect(candidates.map((item) => item.locationId ?? "stay")).toEqual(["stay", "road"]);
    expect(candidates.some((item) => item.locationId === "lake")).toBe(false);
  });

  it("rejects stale revision and a moved NPC before writing", () => {
    const npc = map.npcs[0];
    expect(npc).toBeDefined();
    const candidate = buildNpcCandidates(map, npc!)[1];
    expect(candidate).toBeDefined();
    expect(validateCandidate(candidate!, { ...map, world_revision: 9 })).toMatch(/世界已继续运行/);
    expect(validateCandidate(candidate!, { ...map, npcs: [{ ...npc!, location_id: "road" }] })).toMatch(/已经离开/);
  });
});

describe("DeskBot NPC interaction bridge", () => {
  it("submits a stable interaction id and returns only the canonical response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(interaction), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await interactWithNpc({
      npcId: "npc-1",
      intent: "suggest",
      idea: "  去看看潮水留下的路  ",
      interactionId: "stable-001",
    }, "http://deskbot.test/");

    expect(result.response).toBe(interaction.response);
    expect(result.experience?.experience_id).toBe("stable-001");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      interaction_id: "stable-001",
      npc_id: "npc-1",
      intent: "suggest",
      idea: "去看看潮水留下的路",
      source: "jev-town-world-client",
    });
  });

  it("preserves an idempotent replay returned by DeskBot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...interaction, duplicate: true }), { status: 200 })));
    const result = await interactWithNpc({ npcId: "npc-1", intent: "greet", interactionId: "stable-001" }, "http://deskbot.test");
    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(true);
    expect(result.interaction_id).toBe("stable-001");
  });

  it("surfaces the same-place constraint from the canonical service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "npc_not_present",
      message: "只有与喵呜在同一地点时才能互动",
    }), { status: 409 })));
    await expect(interactWithNpc({ npcId: "remote", intent: "greet" }, "http://deskbot.test"))
      .rejects.toThrow("只有与喵呜在同一地点时才能互动");
  });

  it("reports non-JSON transport failures without inventing an interaction", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("gateway unavailable", { status: 502 })));
    await expect(interactWithNpc({ npcId: "npc-1", intent: "chat" }, "http://deskbot.test"))
      .rejects.toThrow("DeskBot NPC interaction failed");
  });
});

describe("DeskBot chat bridge", () => {
  it("sends chat to DeskBot and extracts the canonical reply and expression intent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      accepted: true,
      turn: {
        reply_event: { payload: { text: "喵，我听见啦。" } },
        state: { interaction: { expression_intent: { mode: "playful", pace: "quick" } } },
      },
    }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendChat({ eventId: "chat-1", characterId: "shaping-001", message: "你好" }, "http://deskbot.test/");

    expect(result).toEqual({ reply: "喵，我听见啦。", expressionIntent: { mode: "playful", pace: "quick" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://deskbot.test/api/chat");
    expect(JSON.parse(String(init?.body))).toEqual({
      event_id: "chat-1",
      character_id: "shaping-001",
      source: "jev-town-world-client",
      message: "你好",
    });
  });

  it("surfaces DeskBot errors and does not invent a reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "provider_unavailable", message: "模型暂不可用" }), { status: 503 })));
    await expect(sendChat({ eventId: "chat-2", characterId: "shaping-001", message: "你好" }, "http://deskbot.test"))
      .rejects.toThrow("模型暂不可用");
  });
});

describe("DeskBot travel bridge", () => {
  const traveledMap: DeskBotWorldMap = {
    ...map,
    world_revision: map.world_revision + 1,
    protagonist: { ...map.protagonist, location_id: "road" },
    locations: map.locations.map((location) => ({
      ...location,
      current: location.location_id === "road",
      reachable: location.location_id === "desk",
    })),
  };
  const travelResponse: DeskBotWorldTravelResponse = {
    schema: "deskbot.world-travel-response.v0.1",
    accepted: true,
    duplicate: false,
    map: traveledMap,
    world_mutation: { applied: true, mutation: { details: { arrival_text: "喵，我到旧路啦。" } } },
  };

  const routeResponse: DeskBotWorldRouteResponse = {
    schema: "deskbot.world-route-response.v0.1",
    world_revision: map.world_revision,
    route: {
      schema: "deskbot.world-route.v0.1",
      world_id: map.world_id,
      world_revision: map.world_revision,
      character_id: map.protagonist.character_id,
      current_location_id: "desk",
      destination_location_id: "road",
      found: true,
      blocked: false,
      blocked_reason: null,
      locations: [{ location_id: "desk", name: "桌边" }, { location_id: "road", name: "旧路" }],
      steps: [{ index: 0, from_location_id: "desk", from_name: "桌边", to_location_id: "road", to_name: "旧路", travel_cost_minutes: 8 }],
      total_cost_minutes: 8,
    },
    map,
  };

  it("reads a canonical route projection for a distant or adjacent destination", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(routeResponse), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchWorldRoute("road", "http://deskbot.test/");

    expect(result.route.steps[0]?.to_location_id).toBe("road");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://deskbot.test/api/world/route?destination_location_id=road");
  });

  it("refreshes canonical reachability before requesting travel", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(map), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(travelResponse), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await travelToLocation({ locationId: "road", eventId: "travel-1", reason: "想去看看" }, "http://deskbot.test/");

    expect(result.map.protagonist.location_id).toBe("road");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://deskbot.test/api/world/map");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://deskbot.test/api/world/travel");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      event_id: "travel-1",
      character_id: "shaping-001",
      location_id: "road",
      reason: "想去看看",
      source: "jev-town-world-client",
    });
  });

  it("rejects unreachable destinations without writing a world event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(map), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(travelToLocation({ locationId: "lake", eventId: "travel-2" }, "http://deskbot.test"))
      .rejects.toThrow("这个地点目前不可直达");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale route hop even when the route context is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(map), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(travelToLocation({
      locationId: "lake",
      eventId: "travel-stale-hop",
      expectedWorldRevision: map.world_revision,
      expectedFromLocationId: "desk",
    }, "http://deskbot.test"))
      .rejects.toThrow("这一步已经不再是当前地点的相邻路线");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces authoritative travel rejection", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(map), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "travel_blocked", message: "道路暂时封闭" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(travelToLocation({ locationId: "road", eventId: "travel-3" }, "http://deskbot.test"))
      .rejects.toThrow("道路暂时封闭");
  });

  it("walks one canonical hop at a time and re-plans after arrival", async () => {
    const finalRoute: DeskBotWorldRouteResponse = {
      ...routeResponse,
      world_revision: traveledMap.world_revision,
      route: { ...routeResponse.route, world_revision: traveledMap.world_revision, current_location_id: "road", destination_location_id: "road", locations: [{ location_id: "road", name: "旧路" }], steps: [], total_cost_minutes: 0 },
      map: traveledMap,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(routeResponse), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(map), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(travelResponse), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(finalRoute), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const steps: Array<{ destinationName: string; fromLocationId: string; toLocationId: string; travelCostMinutes: number }> = [];
    const result = await travelRouteToLocation({ destinationLocationId: "road", eventIdPrefix: "route-1" }, "http://deskbot.test", ({ destinationName, fromLocationId, toLocationId, travelCostMinutes }) => {
      steps.push({ destinationName, fromLocationId, toLocationId, travelCostMinutes });
    });

    expect(result.completed).toBe(true);
    expect(result.stepsCompleted).toBe(1);
    expect(result.map.protagonist.location_id).toBe("road");
    expect(steps).toEqual([{ destinationName: "旧路", fromLocationId: "desk", toLocationId: "road", travelCostMinutes: 8 }]);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      expected_world_revision: map.world_revision,
      expected_from_location_id: "desk",
    });
  });

  it("keeps the original total while re-planning a multi-hop trip", async () => {
    const middleMap: DeskBotWorldMap = {
      ...map,
      world_revision: 9,
      protagonist: { ...map.protagonist, location_id: "road" },
      locations: map.locations.map((location) => ({
        ...location,
        neighbors: location.location_id === "road" ? ["desk", "lake"] : location.location_id === "lake" ? ["road"] : ["road"],
        current: location.location_id === "road",
        // `reachable` is the one-hop presentation hint. The route walker must
        // still accept the lake as the next canonical hop even when the map
        // marks it false for this scenario.
        reachable: location.location_id === "desk",
      })),
    };
    const finalMap: DeskBotWorldMap = {
      ...middleMap,
      world_revision: 10,
      protagonist: { ...middleMap.protagonist, location_id: "lake" },
      locations: middleMap.locations.map((location) => ({ ...location, current: location.location_id === "lake" })),
    };
    const firstRoute: DeskBotWorldRouteResponse = {
      ...routeResponse,
      route: {
        ...routeResponse.route,
        destination_location_id: "lake",
        locations: [{ location_id: "desk", name: "桌边" }, { location_id: "road", name: "旧路" }, { location_id: "lake", name: "水岸" }],
        steps: [
          { index: 0, from_location_id: "desk", from_name: "桌边", to_location_id: "road", to_name: "旧路", travel_cost_minutes: 8 },
          { index: 1, from_location_id: "road", from_name: "旧路", to_location_id: "lake", to_name: "水岸", travel_cost_minutes: 12 },
        ],
        total_cost_minutes: 20,
      },
      map,
    };
    const secondRoute: DeskBotWorldRouteResponse = {
      ...firstRoute,
      world_revision: middleMap.world_revision,
      route: {
        ...firstRoute.route,
        world_revision: middleMap.world_revision,
        current_location_id: "road",
        locations: [{ location_id: "road", name: "旧路" }, { location_id: "lake", name: "水岸" }],
        steps: [{ index: 0, from_location_id: "road", from_name: "旧路", to_location_id: "lake", to_name: "水岸", travel_cost_minutes: 12 }],
        total_cost_minutes: 12,
      },
      map: middleMap,
    };
    const finalRoute: DeskBotWorldRouteResponse = {
      ...secondRoute,
      world_revision: finalMap.world_revision,
      route: { ...secondRoute.route, world_revision: finalMap.world_revision, current_location_id: "lake", locations: [{ location_id: "lake", name: "水岸" }], steps: [], total_cost_minutes: 0 },
      map: finalMap,
    };
    const firstTravel = { ...travelResponse, map: middleMap };
    const secondTravel = { ...travelResponse, map: finalMap };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstRoute), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(map), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(firstTravel), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondRoute), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(middleMap), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondTravel), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(finalRoute), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const progress: Array<{ step: number; total: number }> = [];
    const result = await travelRouteToLocation({ destinationLocationId: "lake", eventIdPrefix: "route-multi" }, "http://deskbot.test", ({ step, total }) => {
      progress.push({ step, total });
    });

    expect(result.stepsCompleted).toBe(2);
    expect(progress).toEqual([{ step: 1, total: 2 }, { step: 2, total: 2 }]);
  });
});
