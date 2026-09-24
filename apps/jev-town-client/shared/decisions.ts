import { ACTIONS, type Action, emptyTally, isAction } from "./actions.ts";
import type { Decision } from "./protocol.ts";

/** The loosely-typed shape a Choice answer arrives in, before validation. */
export interface RawChoiceAnswer {
  type?: unknown;
  choice?: unknown;
  confidence?: unknown;
  probabilities?: unknown;
}

/** A Noul answer: the probability that the statement is true. */
export interface RawNoulAnswer {
  type?: unknown;
  noul?: unknown;
}

/** A Score answer: a probability-weighted position across the described levels. */
export interface RawScoreAnswer {
  type?: unknown;
  score?: unknown;
  legend?: unknown;
}

/** Probability from a Noul answer, or null when unusable. */
export function beliefFromAnswer(answer: RawNoulAnswer | undefined | null): number | null {
  if (!answer || typeof answer !== "object") return null;
  if (typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) return null;
  return clamp01(answer.noul);
}

/**
 * Normalises a Score answer to 0-1 across however many levels the question
 * declared, so callers never depend on the level count.
 */
export function alarmFromAnswer(answer: RawScoreAnswer | undefined | null, levels: number): number | null {
  if (!answer || typeof answer !== "object") return null;
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) return null;
  if (levels < 2) return null;
  return clamp01(answer.score / (levels - 1));
}

/** Mean of a judgement across the round, or null when no citizen has one. */
export function meanOf(decisions: readonly Decision[], key: "belief" | "alarm"): number | null {
  const values = decisions.map((d) => d[key]).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Keeps only the five known options, drops anything non-numeric or negative and
 * renormalises to sum to 1. Returns null when there is nothing usable left.
 */
export function normalizeProbabilities(raw: unknown): Record<Action, number> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const source = raw as Record<string, unknown>;
  const out = emptyTally();
  let sum = 0;

  for (const action of ACTIONS) {
    const value = source[action];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[action] = value;
      sum += value;
    }
  }

  if (sum <= 0) return null;
  for (const action of ACTIONS) out[action] = out[action] / sum;
  return out;
}

/** Highest-probability action, tie-broken by the declared option order. */
export function argmaxAction(probabilities: Record<Action, number>): Action {
  let best: Action = ACTIONS[0];
  for (const action of ACTIONS) {
    if (probabilities[action] > probabilities[best]) best = action;
  }
  return best;
}

function oneHot(action: Action): Record<Action, number> {
  const out = emptyTally();
  out[action] = 1;
  return out;
}

/**
 * Turns one Choice answer into a decision, or null if the answer is unusable.
 *
 * Jev reports `choice` as the argmax of `probabilities`; we trust it when it is a
 * known option and otherwise recompute it, so a surprising option name degrades
 * into a sane decision instead of an exception.
 */
export function decisionFromAnswer(
  citizenId: number,
  answer: RawChoiceAnswer | undefined | null,
): Decision | null {
  if (!answer || typeof answer !== "object") return null;

  const probabilities = normalizeProbabilities(answer.probabilities);
  const declared = isAction(answer.choice) ? answer.choice : null;
  const statedConfidence =
    typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
      ? clamp01(answer.confidence)
      : null;

  if (probabilities) {
    const action = declared ?? argmaxAction(probabilities);
    return {
      citizenId,
      action,
      confidence: statedConfidence ?? clamp01(probabilities[action]),
      probabilities,
    };
  }

  if (declared) {
    return {
      citizenId,
      action: declared,
      confidence: statedConfidence ?? 1,
      probabilities: oneHot(declared),
    };
  }

  return null;
}

export interface MappedDecisions {
  decisions: Decision[];
  /** Citizen ids that had no usable answer and were filled in by the caller. */
  filledLocally: number[];
}

/**
 * Maps a whole batch of answers back onto the roster, in roster order. Answers
 * for unknown question ids are ignored; citizens with no usable answer get a
 * locally generated decision so a partial response never strands a sprite.
 */
export function mapAnswersToDecisions(
  citizenIds: readonly number[],
  answersByCitizenId: ReadonlyMap<number, RawChoiceAnswer>,
  fallback: (citizenId: number) => Decision,
): MappedDecisions {
  const decisions: Decision[] = [];
  const filledLocally: number[] = [];

  for (const citizenId of citizenIds) {
    const mapped = decisionFromAnswer(citizenId, answersByCitizenId.get(citizenId));
    if (mapped) {
      decisions.push(mapped);
    } else {
      decisions.push(fallback(citizenId));
      filledLocally.push(citizenId);
    }
  }

  return { decisions, filledLocally };
}

export function tally(decisions: readonly Decision[]): Record<Action, number> {
  const counts = emptyTally();
  for (const decision of decisions) counts[decision.action] += 1;
  return counts;
}

export function meanConfidence(decisions: readonly Decision[]): number {
  if (decisions.length === 0) return 0;
  const total = decisions.reduce((sum, d) => sum + d.confidence, 0);
  return total / decisions.length;
}
