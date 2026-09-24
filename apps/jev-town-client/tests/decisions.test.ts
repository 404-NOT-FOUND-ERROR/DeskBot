import { describe, expect, it } from "vitest";
import { ACTIONS, emptyTally } from "../shared/actions.ts";
import {
  argmaxAction,
  decisionFromAnswer,
  mapAnswersToDecisions,
  meanConfidence,
  normalizeProbabilities,
  tally,
} from "../shared/decisions.ts";
import type { Decision } from "../shared/protocol.ts";

describe("normalizeProbabilities", () => {
  it("keeps only known actions and renormalizes to 1", () => {
    const result = normalizeProbabilities({ JOIN: 2, FLEE: 2, UNKNOWN_OPTION: 100 });
    expect(result).not.toBeNull();
    expect(result!.JOIN).toBeCloseTo(0.5);
    expect(result!.FLEE).toBeCloseTo(0.5);
    expect(result!.IGNORE).toBe(0);
    const sum = ACTIONS.reduce((s, a) => s + result![a], 0);
    expect(sum).toBeCloseTo(1);
  });

  it("drops non-positive and non-numeric values", () => {
    const result = normalizeProbabilities({ JOIN: -1, FLEE: 0, WARN: "high", INVESTIGATE: 3 });
    expect(result).not.toBeNull();
    expect(result!.INVESTIGATE).toBe(1);
    expect(result!.JOIN).toBe(0);
  });

  it("returns null when there is nothing usable", () => {
    expect(normalizeProbabilities({ JOIN: -1, FLEE: "no" })).toBeNull();
    expect(normalizeProbabilities(null)).toBeNull();
    expect(normalizeProbabilities("nope")).toBeNull();
    expect(normalizeProbabilities([1, 2, 3])).toBeNull();
  });
});

describe("argmaxAction", () => {
  it("picks the highest probability option", () => {
    const probs = { ...emptyTally(), WARN: 0.6, JOIN: 0.4 };
    expect(argmaxAction(probs)).toBe("WARN");
  });

  it("is deterministic on ties, breaking toward declaration order", () => {
    const probs = { ...emptyTally(), IGNORE: 0.5, JOIN: 0.5 };
    expect(argmaxAction(probs)).toBe("IGNORE");
  });
});

describe("decisionFromAnswer", () => {
  it("maps a well-formed Choice answer", () => {
    const decision = decisionFromAnswer(3, {
      type: "choice",
      choice: "FLEE",
      confidence: 0.87,
      probabilities: { FLEE: 0.87, IGNORE: 0.05, INVESTIGATE: 0.03, JOIN: 0.03, WARN: 0.02 },
    });
    expect(decision).toEqual({
      citizenId: 3,
      action: "FLEE",
      confidence: 0.87,
      probabilities: { FLEE: 0.87, IGNORE: 0.05, INVESTIGATE: 0.03, JOIN: 0.03, WARN: 0.02 },
    });
  });

  it("recomputes the action from probabilities when `choice` is missing or unknown", () => {
    const decision = decisionFromAnswer(1, {
      probabilities: { JOIN: 0.1, WARN: 0.7, IGNORE: 0.2 },
    });
    expect(decision?.action).toBe("WARN");
    expect(decision?.confidence).toBeCloseTo(0.7);
  });

  it("falls back to a one-hot distribution when only `choice` is present", () => {
    const decision = decisionFromAnswer(2, { choice: "JOIN" });
    expect(decision?.action).toBe("JOIN");
    expect(decision?.probabilities.JOIN).toBe(1);
    expect(decision?.confidence).toBe(1);
  });

  it("clamps an out-of-range confidence into [0, 1]", () => {
    const decision = decisionFromAnswer(4, { choice: "IGNORE", confidence: 4.2 });
    expect(decision?.confidence).toBe(1);
  });

  it("returns null for garbage input", () => {
    expect(decisionFromAnswer(1, undefined)).toBeNull();
    expect(decisionFromAnswer(1, null)).toBeNull();
    expect(decisionFromAnswer(1, { choice: "NOT_A_REAL_ACTION" })).toBeNull();
    expect(decisionFromAnswer(1, { probabilities: { UNKNOWN: 1 } })).toBeNull();
  });
});

describe("mapAnswersToDecisions", () => {
  it("maps answers in roster order and fills gaps with the fallback", () => {
    const answers = new Map([
      [1, { choice: "JOIN" as const }],
      [3, { choice: "FLEE" as const }],
    ]);

    const fallbackCalls: number[] = [];
    const { decisions, filledLocally } = mapAnswersToDecisions([1, 2, 3], answers, (id) => {
      fallbackCalls.push(id);
      return { citizenId: id, action: "IGNORE", confidence: 0.5, probabilities: { ...emptyTally(), IGNORE: 1 } };
    });

    expect(decisions.map((d) => d.citizenId)).toEqual([1, 2, 3]);
    expect(decisions.map((d) => d.action)).toEqual(["JOIN", "IGNORE", "FLEE"]);
    expect(filledLocally).toEqual([2]);
    expect(fallbackCalls).toEqual([2]);
  });

  it("fills every citizen when the answer map is empty", () => {
    const { decisions, filledLocally } = mapAnswersToDecisions([1, 2], new Map(), (id) => ({
      citizenId: id,
      action: "IGNORE",
      confidence: 0.4,
      probabilities: { ...emptyTally(), IGNORE: 1 },
    }));
    expect(filledLocally).toEqual([1, 2]);
    expect(decisions).toHaveLength(2);
  });
});

describe("tally and meanConfidence", () => {
  const decisions: Decision[] = [
    { citizenId: 1, action: "JOIN", confidence: 0.8, probabilities: { ...emptyTally(), JOIN: 0.8 } },
    { citizenId: 2, action: "JOIN", confidence: 0.6, probabilities: { ...emptyTally(), JOIN: 0.6 } },
    { citizenId: 3, action: "FLEE", confidence: 0.4, probabilities: { ...emptyTally(), FLEE: 0.4 } },
  ];

  it("counts decisions per action", () => {
    const counts = tally(decisions);
    expect(counts.JOIN).toBe(2);
    expect(counts.FLEE).toBe(1);
    expect(counts.WARN).toBe(0);
  });

  it("averages confidence, and returns 0 for an empty list", () => {
    expect(meanConfidence(decisions)).toBeCloseTo(0.6);
    expect(meanConfidence([])).toBe(0);
  });
});
