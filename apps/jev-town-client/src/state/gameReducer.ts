import type { Action } from "@shared/actions.ts";
import { CITIZENS } from "@shared/citizens.ts";
import { directiveForRound, type Directive } from "@shared/directives.ts";
import type { BroadcastResponse, Decision, DecisionSource } from "@shared/protocol.ts";
import { scoreRound, STARTING_TRUST, type RoundResult } from "@shared/scoring.ts";

export type Phase = "idle" | "loading" | "result" | "gameover";

export interface HistoryEntry {
  round: number;
  broadcast: string;
  mode: DecisionSource;
  result: RoundResult;
}

export interface GameState {
  seed: number;
  round: number;
  phase: Phase;
  directive: Directive;
  trust: number;
  unrest: number;
  streak: number;
  bestStreak: number;
  totalScore: number;
  lastActions: Map<number, Action | null>;
  decisions: Decision[] | null;
  lastMode: DecisionSource | null;
  lastReason?: string;
  lastLatencyMs?: number;
  history: HistoryEntry[];
  error: string | null;
}

const MAX_HISTORY = 24;

export function initGame(seed: number): GameState {
  return {
    seed,
    round: 1,
    phase: "idle",
    directive: directiveForRound(1, seed),
    trust: STARTING_TRUST,
    unrest: 0,
    streak: 0,
    bestStreak: 0,
    totalScore: 0,
    lastActions: new Map(CITIZENS.map((c) => [c.id, null])),
    decisions: null,
    lastMode: null,
    history: [],
    error: null,
  };
}

export type GameAction =
  | { type: "BROADCAST_START" }
  | { type: "BROADCAST_ERROR"; message: string }
  | { type: "BROADCAST_SUCCESS"; broadcast: string; response: BroadcastResponse }
  | { type: "NEXT_ROUND" }
  | { type: "RESTART"; seed: number };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "BROADCAST_START":
      return { ...state, phase: "loading", error: null };

    case "BROADCAST_ERROR":
      return { ...state, phase: "idle", error: action.message };

    case "BROADCAST_SUCCESS": {
      const result = scoreRound({
        directive: state.directive,
        decisions: action.response.decisions,
        broadcast: action.broadcast,
        streak: state.streak,
        trust: state.trust,
        unrest: state.unrest,
      });

      const lastActions = new Map(state.lastActions);
      for (const decision of action.response.decisions) {
        lastActions.set(decision.citizenId, decision.action);
      }

      const historyEntry: HistoryEntry = {
        round: state.round,
        broadcast: action.broadcast,
        mode: action.response.mode,
        result,
      };

      return {
        ...state,
        phase: result.gameOver ? "gameover" : "result",
        trust: result.trustAfter,
        unrest: result.unrestAfter,
        streak: result.streakAfter,
        bestStreak: Math.max(state.bestStreak, result.streakAfter),
        totalScore: state.totalScore + result.score.total,
        lastActions,
        decisions: action.response.decisions,
        lastMode: action.response.mode,
        lastReason: action.response.reason,
        lastLatencyMs: action.response.latencyMs,
        history: [historyEntry, ...state.history].slice(0, MAX_HISTORY),
        error: null,
      };
    }

    case "NEXT_ROUND": {
      const round = state.round + 1;
      return {
        ...state,
        round,
        phase: "idle",
        directive: directiveForRound(round, state.seed),
      };
    }

    case "RESTART":
      return initGame(action.seed);

    default:
      return state;
  }
}
