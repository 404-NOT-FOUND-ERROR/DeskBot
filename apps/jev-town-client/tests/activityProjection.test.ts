import { describe, expect, it } from "vitest";
import { activityProgressAt, projectSceneActivities, sceneCitizenId } from "../src/deskbot/activityProjection.ts";
import type { DeskBotWorldMap } from "../src/deskbot/types.ts";

const map = {
  world_id: "test", world_revision: 1,
  protagonist: { character_id: "shaping-001", location_id: "home" },
  npcs: [{ npc_id: "gardener-001", location_id: "home" }],
  locations: [
    { location_id: "home", x: 10, y: 10 },
    { location_id: "garden", x: 60, y: 70 },
  ],
  environment: { projected_at: "2026-10-05T04:05:00Z", time: { mode: "real_time" } },
  tasks: [{ task_id: "trip", actor_id: "gardener-001", kind: "travel", status: "running", title: "前往苗圃",
    from_location_id: "home", to_location_id: "garden", due_at: "2026-10-05T04:10:00Z",
    started_at: "2026-10-05T04:00:00Z", duration_ms: 600000, remaining_ms: 600000 }],
} as unknown as DeskBotWorldMap;

describe("canonical scene activity projection", () => {
  it("uses both residents and protagonist IDs and never fabricates idle tasks", () => {
    const projected = projectSceneActivities(map);
    expect(projected).toHaveLength(1);
    expect(projected[0]?.citizenId).toBe(sceneCitizenId("gardener-001"));
    expect(projected[0]?.locationId).toBe("home");
    expect(projected[0]?.route?.length).toBeGreaterThan(1);
    expect(sceneCitizenId("shaping-001", true)).toBeGreaterThan(500000);
    expect(projectSceneActivities(null)).toEqual([]);
  });
  it("follows actual elapsed time rather than stale remaining_ms and cannot settle arrival", () => {
    const activity = projectSceneActivities(map)[0]!;
    expect(activityProgressAt(activity, Date.parse("2026-10-05T04:05:00Z"))).toBe(.5);
    expect(activityProgressAt(activity, Date.parse("2026-10-05T04:11:00Z"))).toBe(.995);
    expect(map.protagonist.location_id).toBe("home");
  });
  it("keeps paused travel fixed, and simulation frames fixed across wall time", () => {
    const activity = projectSceneActivities(map)[0]!;
    const paused = { ...activity, status: "paused" as const, remainingMs: 450000 };
    expect(activityProgressAt(paused, Date.parse("2026-10-05T05:05:00Z"))).toBe(.25);
    const sample = { ...activity, realTime: false };
    expect(activityProgressAt(sample, Date.parse("2026-10-05T05:05:00Z"))).toBe(.5);
  });
  it("ignores settled and unknown actors and identifies the actual task workplace", () => {
    const changed = structuredClone(map);
    changed.tasks = [
      {...map.tasks![0]!, status:"completed"},
      {...map.tasks![0]!, actor_id:"unadmitted"},
      {...map.tasks![0]!, task_id:"water", actor_id:"shaping-001", kind:"care", life_action:"rest", location_id:"garden"},
    ];
    expect(projectSceneActivities(changed)).toMatchObject([{taskId:"water",kind:"rest",locationId:"garden"}]);
    expect(changed.tasks).toHaveLength(3);
  });
  it("normalizes admitted recipe activity steps into task poses instead of idle", () => {
    const changed=structuredClone(map);
    changed.tasks=[{...map.tasks![0]!,kind:'craft',life_action:'activity',activity_id:'repair-bench'},
      {...map.tasks![0]!,kind:'care',life_action:'activity',activity_id:'share-meal'}];
    expect(projectSceneActivities(changed).map(task=>task.kind)).toEqual(['craft','eat']);
  });
  it('projects actual carried water from the same actor snapshot rather than future recipe output', () => {
    const changed = structuredClone(map);
    changed.living = { schema: 'deskbot.world-living.v1', simulated_until: '2026-10-05T04:05:00Z', revision: 1,
      rule_version: 'test', recovery: { pending: false, target_at: '2026-10-05T04:05:00Z' },
      resource_names: { water: '清水', seeds: '种子' }, inventory: { stock: { water: 4, seeds: 2 }, capacity: 24 },
      recent_changes: [], activities: [] };
    changed.autonomy = { schema: 'deskbot.autonomous-life.v1', enabled: true, installed_at: '2026-10-05T04:00:00Z',
      revision: 1, policy: 'test', recent: [], actors: [{ actor_id: 'gardener-001', display_name: '园丁', location_id: 'home',
        energy: .8, appetite: .2, paused: false, next_decision_at: '2026-10-05T04:10:00Z', plan: null,
        last_feedback: null, inventory: { water: 1, raw_water: 2 } }] };
    changed.tasks = [map.tasks![0]!, { ...map.tasks![0]!, actor_id: 'shaping-001', task_id: 'own-trip' }];
    const activities = projectSceneActivities(changed);
    expect(activities[0]!.carriedStock).toEqual({ water: 1, raw_water: 2 });
    expect(activities[1]!.carriedStock).toEqual({ water: 4, seeds: 2 });
    changed.living!.inventory.stock.water = 0; expect(activities[1]!.carriedStock!.water).toBe(4);
  });
});
