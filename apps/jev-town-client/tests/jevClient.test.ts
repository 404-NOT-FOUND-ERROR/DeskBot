import { describe, expect, it } from "vitest";
import { PLACES, getPlace, BLOCK_PITCH } from "../shared/town.ts";
import { locationOrDefault, simulateLocation } from "../shared/locations.ts";
import { destinationFor } from "../shared/positions.ts";
import { ACTION_CRITERIA, ACTIONS } from "../shared/actions.ts";
import { alarmIdFor, beliefIdFor, CITIZENS, CITIZEN_COUNT, getCitizen, questionIdFor } from "../shared/citizens.ts";
import { ALARM_LEVELS, __testables, loadJevConfig } from "../server/jevClient.ts";

describe("loadJevConfig", () => {
  it("returns null when TYPESAFE_API_KEY is unset or blank", () => {
    expect(loadJevConfig({})).toBeNull();
    expect(loadJevConfig({ TYPESAFE_API_KEY: "   " })).toBeNull();
  });

  it("reads the key and applies documented defaults", () => {
    const config = loadJevConfig({ TYPESAFE_API_KEY: "secret-value" });
    expect(config).not.toBeNull();
    expect(config!.apiKey).toBe("secret-value");
    expect(config!.model).toBe("jev-latest");
    expect(config!.baseUrl).toBe("https://api.typesafe.ai");
    expect(config!.timeoutMs).toBe(20_000);
  });

  it("honors overrides and strips a trailing slash from the base URL", () => {
    const config = loadJevConfig({
      TYPESAFE_API_KEY: "k",
      TYPESAFE_MODEL: "jev-preview",
      TYPESAFE_BASE_URL: "https://custom.example/",
      TYPESAFE_TIMEOUT_MS: "5000",
    });
    expect(config!.model).toBe("jev-preview");
    expect(config!.baseUrl).toBe("https://custom.example");
    expect(config!.timeoutMs).toBe(5000);
  });
});

describe("buildRequestBody", () => {
  const config = { apiKey: "k", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1000 };

  it("batches three judgements per citizen - what they do, whether they believe it, how alarmed they are", () => {
    const body = __testables.buildRequestBody(config, {
      broadcast: "Free bread at the bakery!",
      round: 2,
      unrest: 15,
      history: ["Round 1: a fire drill."],
      lastActions: new Map(),
    }) as { model: string; state: unknown; questions: Record<string, { type: string; criteria: unknown }> };

    expect(body.model).toBe("jev-latest");
    const questionIds = Object.keys(body.questions);
    // Three judgements per citizen, plus one town-wide question: where is this happening?
    expect(questionIds).toHaveLength(CITIZEN_COUNT * 3 + 1);

    for (const citizen of CITIZENS) {
      const choice = body.questions[questionIdFor(citizen.id)]!;
      expect(choice.type).toBe("choice");
      expect(Object.keys(choice.criteria as Record<string, unknown>).sort()).toEqual([...ACTIONS].sort());

      expect(body.questions[beliefIdFor(citizen.id)]!.type).toBe("noul");

      const alarm = body.questions[alarmIdFor(citizen.id)]!;
      expect(alarm.type).toBe("score");
      // Score levels must be ordered lowest to highest, 2-10 of them.
      expect(Array.isArray(alarm.criteria)).toBe(true);
      expect((alarm.criteria as string[]).length).toBe(ALARM_LEVELS.length);
      expect((alarm.criteria as string[]).length).toBeGreaterThanOrEqual(2);
      expect((alarm.criteria as string[]).length).toBeLessThanOrEqual(10);
    }
  });

  it("names the broadcast and the citizen inside every question, not just in shared state", () => {
    // Measured: pointing at `broadcast` in state instead of stating it let personality
    // swamp the announcement, so a burst dam produced more joining in than fleeing.
    const body = __testables.buildRequestBody(config, {
      broadcast: "The dam upstream has burst.",
      round: 3,
      unrest: 10,
      history: [],
      lastActions: new Map([[1, "FLEE"]]),
    }) as { questions: Record<string, { instructions: string }> };

    const first = body.questions[questionIdFor(1)]!;
    expect(first.instructions).toContain("The dam upstream has burst.");
    expect(first.instructions).toContain(getCitizen(1)!.name);
    expect(first.instructions).toContain("flee");

    for (const citizen of CITIZENS) {
      expect(body.questions[questionIdFor(citizen.id)]!.instructions).toContain(citizen.name);
    }
  });

  it("uses the exact five documented action names as criteria keys everywhere", () => {
    expect(Object.keys(ACTION_CRITERIA).sort()).toEqual(["FLEE", "IGNORE", "INVESTIGATE", "JOIN", "WARN"]);
  });

  it("carries the broadcast, round and unrest into state", () => {
    const body = __testables.buildRequestBody(config, {
      broadcast: "hello town",
      round: 7,
      unrest: 33,
      history: [],
      lastActions: new Map(),
    }) as { state: { broadcast: string; round: number; unrest: number; citizens?: unknown[] } };

    expect(body.state.broadcast).toBe("hello town");
    expect(body.state.round).toBe(7);
    expect(body.state.unrest).toBe(33);
    // The roster is deliberately not repeated in state: measured on a burst-dam
    // broadcast, including all fifty profiles here cut "flee or warn" from 28-30
    // of 50 down to 20-21, because it diluted the announcement each question asks about.
    expect(body.state.citizens).toBeUndefined();
  });
});

describe("the location question", () => {
  const config = { apiKey: "k", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1000 };

  it("asks once for the town, over every place on the map", () => {
    const body = __testables.buildRequestBody(config, {
      broadcast: "The bakery is on fire.",
      round: 1,
      unrest: 0,
      history: [],
      lastActions: new Map(),
    }) as { questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }> };

    const location = body.questions.location!;
    expect(location.type).toBe("choice");
    // One option per place, so any announcement can be sited anywhere on the map.
    expect(Object.keys(location.criteria).sort()).toEqual(PLACES.map((p) => p.id).sort());
    expect(location.instructions).toContain("The bakery is on fire.");
  });

  it("falls back to the square when the answer is missing or unknown", () => {
    expect(locationOrDefault(undefined)).toBe("plaza");
    expect(locationOrDefault("not_a_place")).toBe("plaza");
    expect(locationOrDefault("bakery")).toBe("bakery");
  });
});

describe("where citizens walk", () => {
  const citizen = CITIZENS[0]!;

  it("sends investigators and joiners to the place that was announced", () => {
    const bakery = getPlace("bakery");
    const join = destinationFor(citizen, "JOIN", "bakery");
    const investigate = destinationFor(citizen, "INVESTIGATE", "bakery");
    // Both land within a block of the bakery rather than at the fountain.
    expect(Math.hypot(join.x - bakery.x, join.y - bakery.y)).toBeLessThan(BLOCK_PITCH);
    expect(Math.hypot(investigate.x - bakery.x, investigate.y - bakery.y)).toBeLessThan(BLOCK_PITCH);
  });

  it("still sends fleers home and warners to the watchtower, wherever it happened", () => {
    const tower = getPlace("watchtower");
    const warn = destinationFor(citizen, "WARN", "bakery");
    expect(Math.hypot(warn.x - tower.x, warn.y - tower.y)).toBeLessThan(BLOCK_PITCH);

    const home = getPlace(citizen.homeId);
    const flee = destinationFor(citizen, "FLEE", "bakery");
    expect(Math.hypot(flee.x - home.x, flee.y - home.y)).toBeLessThan(BLOCK_PITCH);
  });

  it("defaults to the fountain when no location is given", () => {
    expect(destinationFor(citizen, "JOIN")).toEqual(destinationFor(citizen, "JOIN", "plaza"));
  });
});

describe("the simulation sites events too", () => {
  it("reads the place out of the broadcast", () => {
    expect(simulateLocation("The Orchard Bakery is on fire.")).toBe("bakery");
    expect(simulateLocation("Free gold at the harbor docks!")).toBe("docks");
    expect(simulateLocation("The blacksmith's anvil has cracked.")).toBe("forge");
    expect(simulateLocation("A snake is loose near the fountain.")).toBe("plaza");
  });

  it("falls back to the square when no place is named", () => {
    expect(simulateLocation("Something has happened.")).toBe("plaza");
    expect(simulateLocation("")).toBe("plaza");
  });

  it("is deterministic", () => {
    const text = "Smoke is pouring from the bakery.";
    expect(simulateLocation(text)).toBe(simulateLocation(text));
  });
});
