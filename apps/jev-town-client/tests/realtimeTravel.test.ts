import { afterEach, expect, it, vi } from "vitest";
import { controlWorldTask, travelRouteToLocation } from "../src/deskbot/bridge.ts";
import type { DeskBotWorldMap, DeskBotWorldRouteResponse } from "../src/deskbot/types.ts";

afterEach(() => vi.unstubAllGlobals());

it("hands the full real-time route to the server and does not animate or announce arrival at departure", async () => {
  const map: DeskBotWorldMap = {
    schema: "deskbot.world-map.v0.1", world_id: "test", world_revision: 10,
    logical_time: { day: 1, minute_of_day: 480, tick: 10, date: "2026-10-04" }, clock: { mode: "real_time", rate: 1 },
    protagonist: { character_id: "shaping-001", location_id: "home" }, npcs: [],
    locations: [
      { location_id: "home", name: "家", description: "", x: 0, y: 0, neighbors: ["road"], current: true, reachable: false, arrival_text: "" },
      { location_id: "road", name: "路口", description: "", x: 10, y: 0, neighbors: ["home", "market"], current: false, reachable: true, arrival_text: "到路口了" },
      { location_id: "market", name: "集市", description: "", x: 20, y: 0, neighbors: ["road"], current: false, reachable: false, arrival_text: "到集市了" },
    ],
  };
  const route: DeskBotWorldRouteResponse = { schema: "deskbot.world-route-response.v0.1", world_revision: 10, map,
    route: { schema: "deskbot.world-route.v0.1", world_id: "test", world_revision: 10, character_id: "shaping-001",
      current_location_id: "home", destination_location_id: "market", found: true, blocked: false, blocked_reason: null,
      locations: [{ location_id: "home", name: "家" }, { location_id: "road", name: "路口" }, { location_id: "market", name: "集市" }],
      steps: [
        { index: 0, from_location_id: "home", from_name: "家", to_location_id: "road", to_name: "路口", travel_cost_minutes: 8 },
        { index: 1, from_location_id: "road", from_name: "路口", to_location_id: "market", to_name: "集市", travel_cost_minutes: 12 },
      ], total_cost_minutes: 20 },
  };
  const pendingMap = { ...map, world_revision: 11, protagonist: { ...map.protagonist, travel_state: { status: "travelling", task_id: "trip" } } };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(route)))
    .mockResolvedValueOnce(new Response(JSON.stringify(map)))
    .mockResolvedValueOnce(new Response(JSON.stringify({ schema: "deskbot.world-travel-response.v0.1", accepted: true, duplicate: false, map: pendingMap }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  const onStep = vi.fn();
  const result = await travelRouteToLocation({ destinationLocationId: "market", eventIdPrefix: "trip" }, "http://deskbot.test", onStep);
  expect(result.pending).toBe(true);
  expect(result.completed).toBe(false);
  expect(result.stepsCompleted).toBe(0);
  expect(result.map.protagonist.location_id).toBe("home");
  expect(onStep).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ location_id: "road", destination_location_id: "market", expected_world_revision: 10 });
});

it("controls a durable task through the validated server endpoint", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  await controlWorldTask("trip", "pause", "http://deskbot.test");
  expect(fetchMock.mock.calls[0]?.[0]).toBe("http://deskbot.test/api/world/tasks");
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ task_id: "trip", operation: "pause" });
});
