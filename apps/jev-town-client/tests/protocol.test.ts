import { describe, expect, it } from "vitest";
import { CITIZEN_COUNT } from "../shared/citizens.ts";
import {
  broadcastRequestSchema,
  broadcastResponseSchema,
  formatIssues,
  MAX_BROADCAST_LENGTH,
} from "../shared/protocol.ts";

function validCitizens() {
  return Array.from({ length: CITIZEN_COUNT }, (_, i) => ({ id: i + 1, lastAction: null }));
}

describe("broadcastRequestSchema", () => {
  it("accepts a well-formed request", () => {
    const result = broadcastRequestSchema.safeParse({
      broadcast: "The fountain is on fire.",
      round: 1,
      unrest: 0,
      history: [],
      citizens: validCitizens(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty broadcast", () => {
    const result = broadcastRequestSchema.safeParse({
      broadcast: "   ",
      round: 1,
      unrest: 0,
      history: [],
      citizens: validCitizens(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a broadcast over the max length", () => {
    const result = broadcastRequestSchema.safeParse({
      broadcast: "x".repeat(MAX_BROADCAST_LENGTH + 1),
      round: 1,
      unrest: 0,
      history: [],
      citizens: validCitizens(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatIssues(result.error).join(" ")).toMatch(/240/);
    }
  });

  it("rejects a citizen list that is the wrong length", () => {
    const result = broadcastRequestSchema.safeParse({
      broadcast: "hi",
      round: 1,
      unrest: 0,
      history: [],
      citizens: validCitizens().slice(0, CITIZEN_COUNT - 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate citizen ids", () => {
    const citizens = validCitizens();
    citizens[1] = { ...citizens[0]! };
    const result = broadcastRequestSchema.safeParse({
      broadcast: "hi",
      round: 1,
      unrest: 0,
      history: [],
      citizens,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown citizen id", () => {
    const citizens = validCitizens();
    citizens[0] = { id: 9999, lastAction: null };
    const result = broadcastRequestSchema.safeParse({
      broadcast: "hi",
      round: 1,
      unrest: 0,
      history: [],
      citizens,
    });
    expect(result.success).toBe(false);
  });

  it("rejects unrest out of range", () => {
    const result = broadcastRequestSchema.safeParse({
      broadcast: "hi",
      round: 1,
      unrest: 150,
      history: [],
      citizens: validCitizens(),
    });
    expect(result.success).toBe(false);
  });
});

describe("broadcastResponseSchema", () => {
  it("accepts a simulation response", () => {
    const result = broadcastResponseSchema.safeParse({
      mode: "simulation",
      reason: "no key",
      latencyMs: 12,
      filledLocally: 24,
      decisions: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mode", () => {
    const result = broadcastResponseSchema.safeParse({
      mode: "magic",
      latencyMs: 12,
      filledLocally: 0,
      decisions: [],
    });
    expect(result.success).toBe(false);
  });
});
