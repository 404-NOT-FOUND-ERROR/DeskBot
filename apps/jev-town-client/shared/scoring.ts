import { ACTION_UNREST, type Action } from "./actions.ts";
import { CITIZEN_COUNT } from "./citizens.ts";
import { meanConfidence, meanOf, tally } from "./decisions.ts";
import { goalLabel, type Directive, type Goal } from "./directives.ts";
import type { Decision } from "./protocol.ts";

export const STARTING_TRUST = 3;
export const MAX_TRUST = 5;
export const MAX_UNREST = 100;
/** Broadcasts at or under this length earn the concision bonus. */
export const CONCISE_LENGTH = 90;

export interface GoalResult {
  goal: Goal;
  label: string;
  /** Observed count, or 1/0 for a single named citizen. */
  actual: number;
  /** Count required (or 1 for a named citizen). */
  required: number;
  met: boolean;
  /** 0-1 partial credit, used for the objective score. */
  fulfillment: number;
}

export interface ScoreBreakdown {
  objective: number;
  perfect: number;
  conviction: number;
  concision: number;
  multiplier: number;
  total: number;
}

export interface RoundResult {
  directive: Directive;
  counts: Record<Action, number>;
  goals: GoalResult[];
  success: boolean;
  /** Mean of the goals' partial credit. */
  fulfillment: number;
  score: ScoreBreakdown;
  streakAfter: number;
  trustAfter: number;
  unrestAfter: number;
  unrestDelta: number;
  gameOver: boolean;
  gameOverReason?: string;
}

/**
 * How much a round stirs the town up.
 *
 * When Jev has scored each citizen's alarm, that drives it: the same tally of
 * actions means something different if the town is merely curious or genuinely
 * frightened. `NEUTRAL_ALARM` is the level at which a round neither calms nor
 * inflames. Rounds without alarm (the offline fallback on older data) fall back
 * to fixed per-action weights.
 */
export const NEUTRAL_ALARM = 0.35;

export function unrestDeltaFor(decisions: readonly Decision[]): number {
  const alarm = meanOf(decisions, "alarm");
  if (alarm === null) {
    return decisions.reduce((sum, d) => sum + ACTION_UNREST[d.action], 0) / 6;
  }
  return (alarm - NEUTRAL_ALARM) * 62;
}

export interface RoundInput {
  directive: Directive;
  decisions: readonly Decision[];
  broadcast: string;
  /** Streak of successful rounds before this one. */
  streak: number;
  trust: number;
  unrest: number;
}

function evaluateGoal(goal: Goal, counts: Record<Action, number>, decisions: readonly Decision[]): GoalResult {
  const label = goalLabel(goal);

  if (goal.type === "atLeast") {
    const actual = counts[goal.action];
    return {
      goal,
      label,
      actual,
      required: goal.count,
      met: actual >= goal.count,
      fulfillment: goal.count === 0 ? 1 : Math.min(1, actual / goal.count),
    };
  }

  if (goal.type === "atMost") {
    const actual = counts[goal.action];
    const slack = Math.max(1, CITIZEN_COUNT - goal.count);
    const overshoot = Math.max(0, actual - goal.count);
    return {
      goal,
      label,
      actual,
      required: goal.count,
      met: actual <= goal.count,
      fulfillment: Math.max(0, 1 - overshoot / slack),
    };
  }

  const decision = decisions.find((d) => d.citizenId === goal.citizenId);
  const met = decision?.action === goal.action;
  return {
    goal,
    label,
    actual: met ? 1 : 0,
    required: 1,
    met,
    // Partial credit from how close that citizen came to picking it.
    fulfillment: met ? 1 : (decision?.probabilities[goal.action] ?? 0),
  };
}

/**
 * Citizens whose decision is the thing the directive actually asked for. Their
 * mean confidence becomes the conviction bonus: a broadcast that produces a
 * decisive town scores better than one that produces a hesitant one.
 */
function convictionPool(goals: readonly Goal[], decisions: readonly Decision[]): readonly Decision[] {
  const wanted = new Set<Action>();
  const namedCitizens = new Map<number, Action>();

  for (const goal of goals) {
    if (goal.type === "atLeast") wanted.add(goal.action);
    if (goal.type === "citizen") namedCitizens.set(goal.citizenId, goal.action);
  }

  const pool = decisions.filter((d) => {
    const named = namedCitizens.get(d.citizenId);
    if (named !== undefined) return d.action === named;
    return wanted.has(d.action);
  });

  return pool.length > 0 ? pool : decisions;
}

export function streakMultiplier(streak: number): number {
  return Math.min(3, 1 + 0.25 * Math.max(0, streak));
}

export function scoreRound(input: RoundInput): RoundResult {
  const { directive, decisions, broadcast, streak, trust, unrest } = input;
  const counts = tally(decisions);
  const goals = directive.goals.map((goal) => evaluateGoal(goal, counts, decisions));

  const success = goals.length > 0 && goals.every((g) => g.met);
  const fulfillment =
    goals.length === 0 ? 0 : goals.reduce((sum, g) => sum + g.fulfillment, 0) / goals.length;

  const objective = Math.round(600 * fulfillment);
  const perfect = success ? 250 : 0;
  const conviction = success
    ? Math.round(250 * meanConfidence(convictionPool(directive.goals, decisions)))
    : 0;
  const concision = success && broadcast.trim().length <= CONCISE_LENGTH ? 100 : 0;
  const multiplier = streakMultiplier(success ? streak : 0);
  const total = Math.round((objective + perfect + conviction + concision) * multiplier);

  const streakAfter = success ? streak + 1 : 0;

  let trustAfter = trust;
  if (!success) {
    trustAfter = trust - 1;
  } else if (streakAfter % 3 === 0) {
    trustAfter = Math.min(MAX_TRUST, trust + 1);
  }

  const unrestDelta = Math.round(
    unrestDeltaFor(decisions),
  );
  const unrestAfter = Math.min(MAX_UNREST, Math.max(0, unrest + unrestDelta));

  const gameOver = trustAfter <= 0 || unrestAfter >= MAX_UNREST;
  const gameOverReason = !gameOver
    ? undefined
    : trustAfter <= 0
      ? "The Council revoked your licence to broadcast."
      : "Unrest hit 100. The town stopped listening and started shouting.";

  return {
    directive,
    counts,
    goals,
    success,
    fulfillment,
    score: { objective, perfect, conviction, concision, multiplier, total },
    streakAfter,
    trustAfter,
    unrestAfter,
    unrestDelta,
    gameOver,
    ...(gameOverReason ? { gameOverReason } : {}),
  };
}
