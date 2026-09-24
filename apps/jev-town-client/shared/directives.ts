import { ACTION_LABEL, type Action } from "./actions.ts";
import { CITIZENS, getCitizen } from "./citizens.ts";

export type Goal =
  | { type: "atLeast"; action: Action; count: number }
  | { type: "atMost"; action: Action; count: number }
  | { type: "citizen"; citizenId: number; action: Action };

export interface Directive {
  id: string;
  title: string;
  /** The order as the Town Council would phrase it. */
  brief: string;
  goals: Goal[];
}

/** Deterministic 32-bit LCG. Same round number, same order, every session. */
export function makeRng(seed: number): () => number {
  let state = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const item = items[Math.floor(rng() * items.length) % items.length];
  // items is always non-empty at every call site.
  return item as T;
}

/**
 * Directive targets were tuned for a town of 24; this keeps them proportional
 * to however many citizens the town actually has.
 */
const TOWN_FACTOR = CITIZENS.length / 24;

function scale(round: number, base: number, perRound: number, cap: number): number {
  return Math.min(Math.round(cap * TOWN_FACTOR), Math.round(base * TOWN_FACTOR) + Math.floor((round - 1) * perRound * TOWN_FACTOR));
}

export function goalLabel(goal: Goal): string {
  switch (goal.type) {
    case "atLeast":
      return `${goal.count}+ ${ACTION_LABEL[goal.action]}`;
    case "atMost":
      return `${goal.count} or fewer ${ACTION_LABEL[goal.action]}`;
    case "citizen": {
      const citizen = getCitizen(goal.citizenId);
      return `${citizen?.name ?? `Citizen ${goal.citizenId}`}: ${ACTION_LABEL[goal.action]}`;
    }
  }
}

type Template = (round: number, rng: () => number) => Directive;

const TEMPLATES: Template[] = [
  // Clear the streets.
  (round) => {
    const count = scale(round, 5, 0.9, 15);
    return {
      id: "clear_streets",
      title: "Clear the Streets",
      brief: `The Council wants the lanes empty. Get at least ${count} citizens to flee to their homes.`,
      goals: [{ type: "atLeast", action: "FLEE", count }],
    };
  },

  // Draw a crowd.
  (round) => {
    const count = scale(round, 5, 0.8, 14);
    return {
      id: "draw_crowd",
      title: "Fill the Plaza",
      brief: `The fountain looks lonely. Get at least ${count} citizens to join in at the plaza.`,
      goals: [{ type: "atLeast", action: "JOIN", count }],
    };
  },

  // Spread the word.
  (round) => {
    const count = scale(round, 4, 0.7, 12);
    return {
      id: "spread_word",
      title: "Ring the Bell",
      brief: `Word needs to travel. Get at least ${count} citizens to run and warn the town.`,
      goals: [{ type: "atLeast", action: "WARN", count }],
    };
  },

  // Curiosity.
  (round) => {
    const count = scale(round, 5, 0.8, 14);
    return {
      id: "curiosity",
      title: "Come and See",
      brief: `Make them curious, not frightened. Get at least ${count} citizens to investigate.`,
      goals: [{ type: "atLeast", action: "INVESTIGATE", count }],
    };
  },

  // Keep the peace: say something interesting that changes nothing.
  (round) => {
    const count = scale(round, 14, 0.6, 21);
    return {
      id: "keep_peace",
      title: "Nothing to See",
      brief: `Say something worth saying that moves nobody. At least ${count} citizens must ignore it, and nobody may flee.`,
      goals: [
        { type: "atLeast", action: "IGNORE", count },
        { type: "atMost", action: "FLEE", count: 0 },
      ],
    };
  },

  // Quiet alarm: warn without panic.
  (round) => {
    const warn = scale(round, 4, 0.6, 11);
    const flee = Math.max(1, Math.round(4 * TOWN_FACTOR) - Math.floor((round - 1) / 3));
    return {
      id: "quiet_alarm",
      title: "Quiet Alarm",
      brief: `Alert the town without starting a stampede: at least ${warn} warnings, and no more than ${flee} citizens fleeing.`,
      goals: [
        { type: "atLeast", action: "WARN", count: warn },
        { type: "atMost", action: "FLEE", count: flee },
      ],
    };
  },

  // Targeted persuasion: one named, stubborn person.
  (round, rng) => {
    const citizen = pick(CITIZENS, rng);
    const action = pick(["FLEE", "JOIN", "WARN", "INVESTIGATE"] as const, rng);
    const bystanders = scale(round, 12, 0.8, 20);
    return {
      id: `persuade_${citizen.id}_${action}`,
      title: `Reach ${citizen.name}`,
      brief: `${citizen.name}, ${citizen.role.toLowerCase()}, must ${ACTION_LABEL[
        action
      ].toLowerCase()} - without stirring up the neighbours: at least ${bystanders} other citizens must ignore it.`,
      goals: [
        { type: "citizen", citizenId: citizen.id, action },
        { type: "atLeast", action: "IGNORE", count: bystanders },
      ],
    };
  },

  // Split the town two ways.
  (round, rng) => {
    const [a, b] = pick(
      [
        ["JOIN", "FLEE"],
        ["INVESTIGATE", "FLEE"],
        ["WARN", "JOIN"],
      ] as const,
      rng,
    );
    const count = scale(round, 3, 0.6, 9);
    return {
      id: `split_${a}_${b}`,
      title: "Divide the Town",
      brief: `Split them cleanly: at least ${count} citizens ${ACTION_LABEL[
        a
      ].toLowerCase()} and at least ${count} ${ACTION_LABEL[b].toLowerCase()}.`,
      goals: [
        { type: "atLeast", action: a, count },
        { type: "atLeast", action: b, count },
      ],
    };
  },
];

/**
 * The directive for a given round. Pure in `(round, seed)`, so a run can be
 * replayed and the tests can assert on exact goals.
 */
export function directiveForRound(round: number, seed: number): Directive {
  const rng = makeRng(seed + round * 7919);
  // Early rounds stay on the four simple templates so the rules teach themselves.
  const poolSize = round <= 2 ? 4 : TEMPLATES.length;
  const index = Math.floor(rng() * poolSize) % poolSize;
  const template = TEMPLATES[index] as Template;
  return template(round, rng);
}

export const DIRECTIVE_TEMPLATE_COUNT = TEMPLATES.length;
