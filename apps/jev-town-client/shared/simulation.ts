import { ACTIONS, emptyTally, type Action } from "./actions.ts";
import { CITIZENS, getCitizen, type Citizen } from "./citizens.ts";
import { argmaxAction } from "./decisions.ts";
import type { Decision } from "./protocol.ts";

/** Deterministic string hash, used to seed each citizen's pseudo-random draw. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYWORDS: Partial<Record<Action, string[]>> = {
  FLEE: ["danger", "snake", "fire", "flood", "evacuat", "poison", "collapse", "storm", "toxic", "attack"],
  WARN: ["everyone", "alert", "warning", "urgent", "immediately", "emergency", "attention"],
  JOIN: ["free", "sale", "prize", "contest", "party", "festival", "everyone must", "reward", "gold", "win"],
  INVESTIGATE: ["strange", "mysterious", "unknown", "someone", "sound", "light", "found", "odd"],
};

function keywordBias(broadcast: string): Partial<Record<Action, number>> {
  const lower = broadcast.toLowerCase();
  const bias: Partial<Record<Action, number>> = {};
  for (const action of ACTIONS) {
    const words = KEYWORDS[action];
    if (!words) continue;
    const hits = words.filter((word) => lower.includes(word)).length;
    if (hits > 0) bias[action] = hits * 0.9;
  }
  return bias;
}

/**
 * Offline stand-in for Jev. It combines fixed personality leanings with simple
 * keyword cues, keeping the public static demo playable without exposing a key.
 */
export function simulateDecision(citizen: Citizen, broadcast: string, round: number): Decision {
  const rng = mulberry32(hash(`${citizen.id}:${broadcast}:${round}`));
  const bias = keywordBias(broadcast);
  const weights = emptyTally();

  for (const action of ACTIONS) {
    const base = 1;
    const leaning = citizen.leaning[action] ?? 0;
    const cue = bias[action] ?? 0;
    weights[action] = Math.max(0.02, base + leaning + cue + rng() * 0.5);
  }

  const total = ACTIONS.reduce((sum, action) => sum + weights[action], 0);
  const probabilities = emptyTally();
  for (const action of ACTIONS) probabilities[action] = weights[action] / total;

  const action = argmaxAction(probabilities);
  // The fallback fills belief and alarm too, so the offline demo drives the same
  // meters the live game does rather than silently losing them.
  const alarmBase = probabilities.FLEE * 1 + probabilities.WARN * 0.85 + probabilities.INVESTIGATE * 0.45 + probabilities.JOIN * 0.3;
  return {
    citizenId: citizen.id,
    action,
    confidence: probabilities[action],
    probabilities,
    belief: Math.min(1, Math.max(0, 0.55 + (bias[action] ?? 0) * 0.12 + rng() * 0.25)),
    alarm: Math.min(1, Math.max(0, alarmBase)),
  };
}

export function simulateAllDecisions(broadcast: string, round: number): Decision[] {
  return CITIZENS.map((citizen) => simulateDecision(citizen, broadcast, round));
}

export function simulateFallback(citizenId: number, broadcast: string, round: number): Decision {
  const citizen = getCitizen(citizenId);
  if (!citizen) throw new Error(`Unknown citizen: ${citizenId}`);
  return simulateDecision(citizen, broadcast, round);
}
