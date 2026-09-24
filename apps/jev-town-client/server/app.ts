import express, { type NextFunction, type Request, type Response } from "express";
import { CITIZENS } from "../shared/citizens.ts";
import {
  broadcastRequestSchema,
  formatIssues,
  type BroadcastResponse,
  type StatusResponse,
} from "../shared/protocol.ts";
import { mapAnswersToDecisions } from "../shared/decisions.ts";
import { alarmFromAnswer, beliefFromAnswer } from "../shared/decisions.ts";
import {
  ALARM_LEVELS,
  askJev,
  JevRequestError,
  jevConfigFromKey,
  loadJevConfig,
  readVisitorKey,
  VISITOR_KEY_HEADER,
  type JevConfig,
} from "./jevClient.ts";
import { simulateLocation } from "../shared/locations.ts";
import { createRateLimiter, rateLimitFromEnv, type RateLimitOptions } from "./rateLimit.ts";
import { simulateAllDecisions, simulateFallback } from "./simulation.ts";

export interface CreateAppOptions {
  /** Injected for tests; defaults to reading TYPESAFE_API_KEY from process.env. */
  jevConfig?: JevConfig | null;
  /** Injected for tests; defaults to the BROADCAST_RATE_LIMIT setting. `null` disables limiting. */
  rateLimit?: RateLimitOptions | null;
}

/** Caller address, preferring the proxy header a hosted deployment sets. */
function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return first?.trim() || req.socket.remoteAddress || "unknown";
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "32kb" }));

  const jevConfig = options.jevConfig !== undefined ? options.jevConfig : loadJevConfig();
  const rateLimitOptions = options.rateLimit !== undefined ? options.rateLimit : rateLimitFromEnv();
  // Only meaningful when a key is configured: the offline simulation costs nothing to run.
  const takeToken = rateLimitOptions && jevConfig ? createRateLimiter(rateLimitOptions) : null;

  app.get("/api/status", (_req: Request, res: Response<StatusResponse>) => {
    res.json({
      jevConfigured: jevConfig !== null,
      model: jevConfig?.model ?? "local-simulation",
      citizenCount: CITIZENS.length,
    });
  });

  app.post("/api/broadcast", async (req: Request, res: Response<BroadcastResponse | { error: string; details?: string[] }>) => {
    const parsed = broadcastRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "Invalid broadcast request", details: formatIssues(parsed.error) });
      return;
    }

    // A visitor playing on their own key spends their own quota, so the rate
    // limit - which exists to protect the deployment's key - does not apply.
    const visitorKey = readVisitorKey(req.get(VISITOR_KEY_HEADER));
    const roundConfig = visitorKey ? jevConfigFromKey(visitorKey) : jevConfig;
    const keySource: "visitor" | "server" = visitorKey ? "visitor" : "server";

    if (takeToken && !visitorKey) {
      const quota = takeToken(clientKey(req));
      if (!quota.allowed) {
        res.setHeader("Retry-After", String(quota.retryAfterSeconds));
        res.status(429).json({ error: "Too many broadcasts from this address. Try again a bit later." });
        return;
      }
    }

    const { broadcast, round, unrest, history, citizens } = parsed.data;
    const citizenIds = citizens.map((c) => c.id);
    const started = performance.now();

    if (!roundConfig) {
      const decisions = simulateAllDecisions(broadcast, round);
      res.json({
        mode: "simulation",
        reason: "No Jev key: add your own key to play with live decisions.",
        locationId: simulateLocation(broadcast),
        latencyMs: Math.round(performance.now() - started),
        filledLocally: decisions.length,
        decisions,
      });
      return;
    }

    try {
      const lastActions = new Map(citizens.map((c) => [c.id, c.lastAction]));
      const result = await askJev(roundConfig, { broadcast, round, unrest, history, lastActions });

      const { decisions, filledLocally } = mapAnswersToDecisions(
        citizenIds,
        result.answers,
        (citizenId) => simulateFallback(citizenId, broadcast, round),
      );

      // Belief and alarm are independent judgements about the same citizen; a
      // missing one simply leaves that field off rather than failing the round.
      for (const decision of decisions) {
        const belief = beliefFromAnswer(result.beliefs.get(decision.citizenId));
        const alarm = alarmFromAnswer(result.alarms.get(decision.citizenId), ALARM_LEVELS.length);
        if (belief !== null) decision.belief = belief;
        if (alarm !== null) decision.alarm = alarm;
      }

      res.json({
        mode: "jev",
        model: result.model,
        keySource,
        locationId: result.locationId,
        latencyMs: Math.round(performance.now() - started),
        filledLocally: filledLocally.length,
        ...(result.usage ? { usage: result.usage } : {}),
        decisions,
      });
    } catch (err) {
      const message = err instanceof JevRequestError ? err.message : "Unexpected error contacting Jev.";
      // Never log request/response bodies here: they could echo back the Authorization header context.
      console.error(`[jev] falling back to simulation: ${message}`);

      const decisions = simulateAllDecisions(broadcast, round);
      res.json({
        mode: "simulation",
        reason: message,
        locationId: simulateLocation(broadcast),
        latencyMs: Math.round(performance.now() - started),
        filledLocally: decisions.length,
        decisions,
      });
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[server] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
