import { describe, expect, it } from "vitest";
import { alarmFromAnswer, beliefFromAnswer, meanOf } from "../shared/decisions.ts";
import { NEUTRAL_ALARM, unrestDeltaFor } from "../shared/scoring.ts";
import type { Decision } from "../shared/protocol.ts";

function decision(extra: Partial<Decision> = {}): Decision {
  return {
    citizenId: 1,
    action: "IGNORE",
    confidence: 0.9,
    probabilities: { IGNORE: 1, INVESTIGATE: 0, JOIN: 0, FLEE: 0, WARN: 0 },
    ...extra,
  };
}

describe("beliefFromAnswer", () => {
  it("reads the Noul probability and clamps it", () => {
    expect(beliefFromAnswer({ type: "noul", noul: 0.82 })).toBeCloseTo(0.82);
    expect(beliefFromAnswer({ type: "noul", noul: 1.4 })).toBe(1);
    expect(beliefFromAnswer({ type: "noul", noul: -2 })).toBe(0);
  });

  it("returns null for anything unusable, rather than guessing", () => {
    expect(beliefFromAnswer(null)).toBeNull();
    expect(beliefFromAnswer({})).toBeNull();
    expect(beliefFromAnswer({ noul: "very" as unknown as number })).toBeNull();
  });
});

describe("alarmFromAnswer", () => {
  it("normalises a Score to 0-1 across however many levels were declared", () => {
    expect(alarmFromAnswer({ type: "score", score: 0 }, 5)).toBe(0);
    expect(alarmFromAnswer({ type: "score", score: 4 }, 5)).toBe(1);
    expect(alarmFromAnswer({ type: "score", score: 2 }, 5)).toBeCloseTo(0.5);
    expect(alarmFromAnswer({ type: "score", score: 1.3 }, 5)).toBeCloseTo(0.325);
  });

  it("refuses nonsense", () => {
    expect(alarmFromAnswer({ score: 2 }, 1)).toBeNull();
    expect(alarmFromAnswer(undefined, 5)).toBeNull();
  });
});

describe("meanOf", () => {
  it("averages only the citizens that have the judgement", () => {
    const decisions = [decision({ alarm: 0.2 }), decision({ alarm: 0.8 }), decision()];
    expect(meanOf(decisions, "alarm")).toBeCloseTo(0.5);
    expect(meanOf([decision()], "alarm")).toBeNull();
  });
});

describe("unrestDeltaFor", () => {
  it("calms the town when alarm sits below neutral and inflames it above", () => {
    const calm = [decision({ alarm: 0.05 }), decision({ alarm: 0.1 })];
    const frantic = [decision({ alarm: 0.9 }), decision({ alarm: 1 })];
    expect(unrestDeltaFor(calm)).toBeLessThan(0);
    expect(unrestDeltaFor(frantic)).toBeGreaterThan(20);
    expect(unrestDeltaFor([decision({ alarm: NEUTRAL_ALARM })])).toBeCloseTo(0);
  });

  it("separates the same actions by how alarmed the town actually was", () => {
    const shape = { action: "INVESTIGATE" as const };
    const curious = [decision({ ...shape, alarm: 0.2 }), decision({ ...shape, alarm: 0.25 })];
    const frightened = [decision({ ...shape, alarm: 0.85 }), decision({ ...shape, alarm: 0.9 })];
    expect(unrestDeltaFor(frightened)).toBeGreaterThan(unrestDeltaFor(curious));
  });

  it("falls back to per-action weights when no citizen was scored", () => {
    expect(unrestDeltaFor([decision({ action: "FLEE" }), decision({ action: "FLEE" })])).toBeCloseTo(2);
  });
});
