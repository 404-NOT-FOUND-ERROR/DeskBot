import { z } from "zod";
import { ACTIONS } from "./actions.ts";
import { CITIZENS } from "./citizens.ts";

export const MAX_BROADCAST_LENGTH = 240;

const VALID_CITIZEN_IDS = new Set(CITIZENS.map((c) => c.id));

export const actionSchema = z.enum(ACTIONS);

export const citizenStateSchema = z.object({
  id: z
    .number()
    .int()
    .refine((id) => VALID_CITIZEN_IDS.has(id), { message: "unknown citizen id" }),
  lastAction: actionSchema.nullable().default(null),
});

export const broadcastRequestSchema = z.object({
  broadcast: z
    .string()
    .trim()
    .min(1, "Say something to the town.")
    .max(MAX_BROADCAST_LENGTH, `Keep it under ${MAX_BROADCAST_LENGTH} characters.`),
  round: z.number().int().min(1).max(999),
  unrest: z.number().min(0).max(100),
  /** Short summaries of earlier rounds, oldest first. Gives the town a memory. */
  history: z.array(z.string().max(280)).max(4).default([]),
  citizens: z
    .array(citizenStateSchema)
    .length(CITIZENS.length, `Expected ${CITIZENS.length} citizens.`)
    .refine((list) => new Set(list.map((c) => c.id)).size === list.length, {
      message: "duplicate citizen id",
    }),
});

export type BroadcastRequest = z.infer<typeof broadcastRequestSchema>;

export const decisionSchema = z.object({
  citizenId: z.number().int(),
  action: actionSchema,
  confidence: z.number().min(0).max(1),
  probabilities: z.record(actionSchema, z.number()),
  /** Jev Noul: probability this citizen believes the announcement is true. */
  belief: z.number().min(0).max(1).optional(),
  /** Jev Score, normalised to 0-1: how alarmed this citizen is. */
  alarm: z.number().min(0).max(1).optional(),
});

export type Decision = z.infer<typeof decisionSchema>;

export const DECISION_SOURCES = ["jev", "simulation"] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

export const broadcastResponseSchema = z.object({
  mode: z.enum(DECISION_SOURCES),
  /** Present when the town fell back to the offline simulation. */
  reason: z.string().optional(),
  model: z.string().optional(),
  /** Whose key paid for this round: the deployment's, or one the visitor supplied. */
  keySource: z.enum(["server", "visitor"]).optional(),
  /** Where the broadcast is happening; citizens who go and look walk here. */
  locationId: z.string().optional(),
  latencyMs: z.number(),
  /** Citizens Jev did not answer for, filled in locally. */
  filledLocally: z.number().int().min(0),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .optional(),
  decisions: z.array(decisionSchema),
});

export type BroadcastResponse = z.infer<typeof broadcastResponseSchema>;

export const statusResponseSchema = z.object({
  /** True when TYPESAFE_API_KEY is set on the server. The key itself never leaves it. */
  jevConfigured: z.boolean(),
  model: z.string(),
  citizenCount: z.number().int(),
});

export type StatusResponse = z.infer<typeof statusResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.string(),
  details: z.array(z.string()).optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Flattens a ZodError into short, user-presentable strings. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
