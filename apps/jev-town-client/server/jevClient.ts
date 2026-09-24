import { ACTION_CRITERIA, ACTIONS } from "../shared/actions.ts";
import { LOCATION_CRITERIA, locationOrDefault } from "../shared/locations.ts";
import type { PlaceId } from "../shared/town.ts";
import { CITIZENS, alarmIdFor, beliefIdFor, questionIdFor } from "../shared/citizens.ts";
import type { RawChoiceAnswer, RawNoulAnswer, RawScoreAnswer } from "../shared/decisions.ts";

const ENDPOINT_PATH = "/v1/systemone";
/** Question id for the one town-wide question: where is this happening? */
const LOCATION_QUESTION_ID = "location";
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT_MS = 20_000;

export interface JevConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

/**
 * The hosted deployment is bring-your-own-key: it must never spend the owner's
 * quota on anonymous visitors. So when running on Vercel, `TYPESAFE_API_KEY` is
 * ignored unless `JEV_ALLOW_SERVER_KEY` is explicitly set to "true". Leaving the
 * key in the project settings is therefore not enough to put it back into
 * service, which is the safe default for a public URL.
 *
 * Local development is unaffected: `npm run dev` with a key in the environment
 * still plays on live Jev.
 */
export function loadJevConfig(env: NodeJS.ProcessEnv = process.env): JevConfig | null {
  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return null;

  const hosted = env.VERCEL === "1";
  const allowServerKey = env.JEV_ALLOW_SERVER_KEY?.trim() === "true";
  if (hosted && !allowServerKey) return null;

  return jevConfigFromKey(apiKey, env);
}

/**
 * Builds a config around a key supplied per request rather than from the
 * environment, so a visitor can play with their own Jev key on a deployment
 * that carries none. The key is used for the one outbound call and then
 * dropped: it is never stored, cached, or written to a log.
 */
export function jevConfigFromKey(apiKey: string, env: NodeJS.ProcessEnv = process.env): JevConfig {
  return {
    apiKey,
    baseUrl: (env.TYPESAFE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: env.TYPESAFE_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number(env.TYPESAFE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

/** Header a visitor's own key arrives in. Never logged, never persisted. */
export const VISITOR_KEY_HEADER = "x-typesafe-key";

/**
 * A key is only accepted if it looks like one: a single line of plausible
 * length with no whitespace. This rejects pasted junk before it costs a round
 * trip, and keeps anything odd out of the outbound Authorization header.
 */
export function readVisitorKey(header: unknown): string | null {
  if (typeof header !== "string") return null;
  const key = header.trim();
  if (key.length < 16 || key.length > 200) return null;
  if (/\s/.test(key)) return null;
  return key;
}

export interface JevRoundState {
  broadcast: string;
  round: number;
  unrest: number;
  history: string[];
  /** Per-citizen last action, keyed by citizen id, for continuity across rounds. */
  lastActions: ReadonlyMap<number, string | null>;
}

/**
 * Ordered levels for the alarm Score, lowest first. Each describes a concrete
 * situation so it stands on its own, as Score questions require.
 */
export const ALARM_LEVELS = [
  "Completely unbothered; the announcement does not concern them at all.",
  "Mildly curious or interested, but carrying on regardless.",
  "Concerned enough to stop what they were doing and react.",
  "Frightened; they believe they are personally at risk right now.",
  "Panicking; they do not think anywhere nearby is safe.",
] as const;

/** Place ids read better to the model as plain words than as snake_case keys. */
function placeWords(placeId: string): string {
  return placeId.replace(/_/g, " ");
}

function buildRequestBody(config: JevConfig, input: JevRoundState) {
  const questions: Record<string, unknown> = {};

  for (const citizen of CITIZENS) {
    const lastAction = input.lastActions.get(citizen.id) ?? null;
    // Each question states the announcement and who is hearing it, rather than
    // pointing at `broadcast` in shared state and asking the model to answer in
    // character. Measured on six contrasting broadcasts, the indirect phrasing let
    // personality swamp the announcement: a burst dam produced more citizens
    // joining in than fleeing, and wildly different broadcasts produced the same
    // decision for a given citizen 69% of the time. Naming both in the question
    // took "flee or warn" on that disaster from 12 of 50 to 30 of 50.
    const hears = [
      `The Town Crier just shouted this to the whole town: "${input.broadcast}"`,
      `${citizen.name}, ${citizen.role.toLowerCase()}, hears it. ${citizen.personality}`,
      `They are at work at the ${placeWords(citizen.workId)}; home is ${placeWords(citizen.homeId)}.`,
      lastAction ? `Last round they chose to ${lastAction.toLowerCase()}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    // Three independent judgements about the same person, asked together: what they
    // do (Choice), whether they buy it (Noul), and how rattled they are (Score).
    questions[questionIdFor(citizen.id)] = {
      type: "choice",
      instructions: [
        hears,
        "What does this particular person actually do in the next few seconds, given what was just announced?",
        "Weigh what the announcement means for them personally: an opportunity to take part in, a danger to escape, something to go and check, something the rest of the town must be warned about, or nothing worth interrupting their work for.",
        "Their personality decides the cases the announcement leaves genuinely ambiguous.",
      ].join(" "),
      criteria: ACTION_CRITERIA,
    };

    questions[beliefIdFor(citizen.id)] = {
      type: "noul",
      instructions: `${hears} Does this person believe the announcement is true?`,
      criteria: {
        true: "They take it at face value: a real event, worth acting on.",
        false: "They doubt it: a prank, a rumour, an exaggeration, or a mistake.",
      },
    };

    questions[alarmIdFor(citizen.id)] = {
      type: "score",
      instructions: `${hears} How alarmed is this person right now?`,
      criteria: [...ALARM_LEVELS],
    };
  }

  // Where the announcement is happening, asked once for the town rather than
  // once per citizen: it is a property of the broadcast, not of the person
  // hearing it. Citizens who go and look are routed here instead of always
  // converging on the fountain.
  questions[LOCATION_QUESTION_ID] = {
    type: "choice",
    instructions: [
      `The Town Crier just shouted this to the whole town: "${input.broadcast}"`,
      "Which place in town is this announcement about?",
      "Pick the spot a curious person would walk to in order to see it for themselves.",
      "If it names no particular place, or concerns the whole town at once, answer with the fountain square.",
    ].join(" "),
    criteria: LOCATION_CRITERIA,
  };

  return {
    model: config.model,
    // State carries only what the whole town shares. The roster used to be repeated
    // here as well, which measurably diluted the announcement: with all fifty
    // profiles in state, a burst dam produced 20-21 of 50 fleeing or warning; without
    // them, 28-30. Each question already names the one citizen it is about.
    state: {
      broadcast: input.broadcast,
      round: input.round,
      unrest: input.unrest,
      history: input.history,
    },
    questions,
  };
}

export class JevRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "JevRequestError";
  }
}

export interface JevRoundResult {
  model: string;
  /** Where the broadcast is happening; citizens who go and look head here. */
  locationId: PlaceId;
  answers: Map<number, RawChoiceAnswer>;
  /** Noul answers: does this citizen believe the broadcast? */
  beliefs: Map<number, RawNoulAnswer>;
  /** Score answers: how alarmed is this citizen? */
  alarms: Map<number, RawScoreAnswer>;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Fires one batched Choice request covering every citizen. Never logs the API
 * key or the raw Authorization header; only status codes and message text are
 * surfaced on failure.
 */
export async function askJev(config: JevConfig, input: JevRoundState): Promise<JevRoundResult> {
  const body = buildRequestBody(config, input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${ENDPOINT_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new JevRequestError(`Jev request timed out after ${config.timeoutMs}ms`);
    }
    throw new JevRequestError(
      `Could not reach Jev: ${err instanceof Error ? err.message : "unknown network error"}`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const label =
      response.status === 401
        ? "Jev rejected the API key"
        : response.status === 422
          ? "Jev rejected the request shape"
          : response.status === 429
            ? "Jev rate limit exceeded"
            : response.status === 529
              ? "Jev is overloaded"
              : "Jev request failed";
    throw new JevRequestError(`${label} (HTTP ${response.status})`, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new JevRequestError("Jev returned a response that was not valid JSON");
  }

  return parseJevPayload(payload);
}

function parseJevPayload(payload: unknown): JevRoundResult {
  if (typeof payload !== "object" || payload === null) {
    throw new JevRequestError("Jev response was not a JSON object");
  }

  const record = payload as Record<string, unknown>;
  const answersRaw = record.answers;
  if (typeof answersRaw !== "object" || answersRaw === null) {
    throw new JevRequestError("Jev response had no `answers` field");
  }

  const answers = new Map<number, RawChoiceAnswer>();
  const beliefs = new Map<number, RawNoulAnswer>();
  const alarms = new Map<number, RawScoreAnswer>();
  for (const [questionId, answer] of Object.entries(answersRaw as Record<string, unknown>)) {
    const match = /^(citizen|believes|alarm)_(\d{1,3})$/.exec(questionId);
    if (!match) continue;
    const citizenId = Number(match[2]);
    if (Number.isNaN(citizenId)) continue;
    if (match[1] === "citizen") answers.set(citizenId, answer as RawChoiceAnswer);
    else if (match[1] === "believes") beliefs.set(citizenId, answer as RawNoulAnswer);
    else alarms.set(citizenId, answer as RawScoreAnswer);
  }

  const usageRaw = record.usage;
  const usage =
    typeof usageRaw === "object" && usageRaw !== null
      ? {
          inputTokens: Number((usageRaw as Record<string, unknown>).input_tokens) || 0,
          outputTokens: Number((usageRaw as Record<string, unknown>).output_tokens) || 0,
        }
      : undefined;

  const locationAnswer = (answersRaw as Record<string, unknown>)[LOCATION_QUESTION_ID];
  const locationChoice =
    typeof locationAnswer === "object" && locationAnswer !== null
      ? (locationAnswer as Record<string, unknown>).choice
      : null;

  return {
    model: typeof record.model === "string" ? record.model : "jev",
    locationId: locationOrDefault(locationChoice),
    answers,
    beliefs,
    alarms,
    ...(usage ? { usage } : {}),
  };
}

/** Exposed for tests only: confirms the exact option set sent to Jev never drifts. */
export const __testables = { buildRequestBody, ACTIONS };
