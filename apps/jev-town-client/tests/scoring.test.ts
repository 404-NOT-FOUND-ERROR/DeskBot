import { describe, expect, it } from "vitest";
import { emptyTally } from "../shared/actions.ts";
import { CITIZENS } from "../shared/citizens.ts";
import { directiveForRound } from "../shared/directives.ts";
import type { Decision } from "../shared/protocol.ts";
import { MAX_TRUST, STARTING_TRUST, scoreRound, streakMultiplier } from "../shared/scoring.ts";

function decisionsWhere(pick: (citizenId: number, index: number) => Decision["action"]): Decision[] {
  return CITIZENS.map((c, index) => {
    const action = pick(c.id, index);
    return {
      citizenId: c.id,
      action,
      confidence: 0.75,
      probabilities: { ...emptyTally(), [action]: 0.75 },
    };
  });
}

describe("streakMultiplier", () => {
  it("is 1x with no streak and caps at 3x", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(4)).toBe(2);
    expect(streakMultiplier(100)).toBe(3);
  });
});

describe("scoreRound", () => {
  it("succeeds and raises the streak when every goal is met", () => {
    const directive = { id: "t", title: "T", brief: "b", goals: [{ type: "atLeast" as const, action: "FLEE" as const, count: 3 }] };
    const decisions = decisionsWhere((_, index) => (index < 5 ? "FLEE" : "IGNORE"));

    const result = scoreRound({
      directive,
      decisions,
      broadcast: "run",
      streak: 2,
      trust: STARTING_TRUST,
      unrest: 10,
    });

    expect(result.success).toBe(true);
    expect(result.streakAfter).toBe(3);
    expect(result.score.total).toBeGreaterThan(0);
    // Streak just hit a multiple of 3: trust should tick up (capped at MAX_TRUST).
    expect(result.trustAfter).toBe(Math.min(MAX_TRUST, STARTING_TRUST + 1));
  });

  it("fails, resets the streak, and costs trust when a goal is missed", () => {
    const directive = { id: "t", title: "T", brief: "b", goals: [{ type: "atLeast" as const, action: "WARN" as const, count: 10 }] };
    const decisions = decisionsWhere(() => "IGNORE");

    const result = scoreRound({
      directive,
      decisions,
      broadcast: "shh",
      streak: 4,
      trust: STARTING_TRUST,
      unrest: 0,
    });

    expect(result.success).toBe(false);
    expect(result.streakAfter).toBe(0);
    expect(result.trustAfter).toBe(STARTING_TRUST - 1);
    expect(result.score.perfect).toBe(0);
    expect(result.score.conviction).toBe(0);
  });

  it("ends the game when trust reaches zero", () => {
    const directive = { id: "t", title: "T", brief: "b", goals: [{ type: "atLeast" as const, action: "WARN" as const, count: 99 }] };
    const decisions = decisionsWhere(() => "IGNORE");

    const result = scoreRound({ directive, decisions, broadcast: "x", streak: 0, trust: 1, unrest: 0 });

    expect(result.trustAfter).toBe(0);
    expect(result.gameOver).toBe(true);
    expect(result.gameOverReason).toMatch(/licence/i);
  });

  it("ends the game when unrest saturates at 100", () => {
    const directive = { id: "t", title: "T", brief: "b", goals: [{ type: "atLeast" as const, action: "FLEE" as const, count: 1 }] };
    const decisions = decisionsWhere(() => "FLEE");

    const result = scoreRound({ directive, decisions, broadcast: "x", streak: 0, trust: STARTING_TRUST, unrest: 97 });

    expect(result.unrestAfter).toBe(100);
    expect(result.gameOver).toBe(true);
    expect(result.gameOverReason).toMatch(/unrest/i);
  });

  it("scores a single named-citizen goal by exact identity, not by count", () => {
    const target = CITIZENS[0]!;
    const directive = { id: "t", title: "T", brief: "b", goals: [{ type: "citizen" as const, citizenId: target.id, action: "FLEE" as const }] };

    const hit = decisionsWhere((id) => (id === target.id ? "FLEE" : "IGNORE"));
    const miss = decisionsWhere((id) => (id === target.id ? "JOIN" : "IGNORE"));

    expect(scoreRound({ directive, decisions: hit, broadcast: "x", streak: 0, trust: STARTING_TRUST, unrest: 0 }).success).toBe(true);
    expect(scoreRound({ directive, decisions: miss, broadcast: "x", streak: 0, trust: STARTING_TRUST, unrest: 0 }).success).toBe(false);
  });

  it("awards the concision bonus only on a short, successful broadcast", () => {
    const directive = { id: "t", title: "T", brief: "b", goals: [{ type: "atLeast" as const, action: "JOIN" as const, count: 1 }] };
    const decisions = decisionsWhere(() => "JOIN");

    const short = scoreRound({ directive, decisions, broadcast: "join now", streak: 0, trust: STARTING_TRUST, unrest: 0 });
    const long = scoreRound({
      directive,
      decisions,
      broadcast: "x".repeat(200),
      streak: 0,
      trust: STARTING_TRUST,
      unrest: 0,
    });

    expect(short.score.concision).toBe(100);
    expect(long.score.concision).toBe(0);
  });
});

describe("directiveForRound", () => {
  it("is deterministic for a given round and seed", () => {
    const a = directiveForRound(5, 42);
    const b = directiveForRound(5, 42);
    expect(a).toEqual(b);
  });

  it("only uses the four simple templates in the first two rounds", () => {
    for (let seed = 0; seed < 50; seed++) {
      const directive = directiveForRound(1, seed);
      expect(["clear_streets", "draw_crowd", "spread_word", "curiosity"]).toContain(directive.id);
    }
  });
});
