/**
 * The five reactions a citizen can pick. These are the exact option keys sent to
 * Jev as the `criteria` of every Choice question, so the wire format and the game
 * rules can never drift apart.
 */
export const ACTIONS = ["IGNORE", "INVESTIGATE", "JOIN", "FLEE", "WARN"] as const;

export type Action = (typeof ACTIONS)[number];

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

/**
 * Option descriptions handed to the model. They describe observable behaviour
 * rather than emotion, so the model is choosing between concrete, mutually
 * exclusive things a person does in the next few seconds.
 */
export const ACTION_CRITERIA: Record<Action, string> = {
  IGNORE:
    "Carry on with whatever they were already doing. The broadcast is irrelevant, beneath their notice, obviously false, or simply not worth interrupting their work for.",
  INVESTIGATE:
    "Stop working and go to wherever this is happening, to see it for themselves before committing to anything. They want first-hand evidence, not a second-hand announcement.",
  JOIN:
    "Actively take part in what was announced: claim the offer, help with the effort, or throw themselves into the crowd at the heart of it. They want in.",
  FLEE:
    "Leave for the safety of their own home and stay there. They judge the situation as dangerous, hostile, or about to get worse for them personally.",
  WARN:
    "Run to the watchtower bell to alert the rest of the town. Their first instinct is that other people need to know about this right now.",
};

export const ACTION_LABEL: Record<Action, string> = {
  IGNORE: "Ignore",
  INVESTIGATE: "Investigate",
  JOIN: "Join in",
  FLEE: "Flee home",
  WARN: "Warn others",
};

/** Short verb used in the event log and speech bubbles. */
export const ACTION_BLURB: Record<Action, string> = {
  IGNORE: "shrugs it off",
  INVESTIGATE: "goes to look",
  JOIN: "piles in",
  FLEE: "bolts for home",
  WARN: "rings the bell",
};

export const ACTION_GLYPH: Record<Action, string> = {
  IGNORE: "·",
  INVESTIGATE: "?",
  JOIN: "!",
  FLEE: "»",
  WARN: "▲",
};

/** How much each reaction stirs the town up. Used for the Unrest meter. */
export const ACTION_UNREST: Record<Action, number> = {
  IGNORE: -2,
  INVESTIGATE: 1,
  JOIN: 2,
  FLEE: 6,
  WARN: 5,
};

export function emptyTally(): Record<Action, number> {
  return { IGNORE: 0, INVESTIGATE: 0, JOIN: 0, FLEE: 0, WARN: 0 };
}
