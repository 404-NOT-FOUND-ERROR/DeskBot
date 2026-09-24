import { describe, expect, it } from "vitest";
import { CITIZEN_COUNT } from "../shared/citizens.ts";
import { createApp } from "../server/app.ts";
import { createRateLimiter, rateLimitFromEnv } from "../server/rateLimit.ts";

describe("createRateLimiter", () => {
  it("allows up to the limit, then refuses until the window resets", () => {
    let now = 1_000;
    const take = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => now });

    expect(take("a").allowed).toBe(true);
    expect(take("a").allowed).toBe(true);
    expect(take("a")).toMatchObject({ allowed: true, remaining: 0 });

    const refused = take("a");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);

    now += 60_001;
    expect(take("a").allowed).toBe(true);
  });

  it("counts each caller separately", () => {
    const take = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(take("a").allowed).toBe(true);
    expect(take("b").allowed).toBe(true);
    expect(take("a").allowed).toBe(false);
  });
});

describe("rateLimitFromEnv", () => {
  it("defaults to 60 broadcasts an hour and can be disabled or overridden", () => {
    expect(rateLimitFromEnv({})).toMatchObject({ limit: 60, windowMs: 3_600_000 });
    expect(rateLimitFromEnv({ BROADCAST_RATE_LIMIT: "5" })).toMatchObject({ limit: 5 });
    expect(rateLimitFromEnv({ BROADCAST_RATE_LIMIT: "0" })).toBeNull();
    expect(rateLimitFromEnv({ BROADCAST_RATE_LIMIT: "nonsense" })).toBeNull();
  });
});

describe("POST /api/broadcast rate limiting", () => {
  const jevConfig = {
    apiKey: "test-key",
    baseUrl: "https://api.example.invalid",
    model: "jev-test",
    timeoutMs: 50,
  };

  function body(round: number) {
    return {
      broadcast: "Test broadcast",
      round,
      unrest: 0,
      history: [],
      citizens: Array.from({ length: CITIZEN_COUNT }, (_, i) => ({ id: i + 1, lastAction: null })),
    };
  }

  async function post(baseUrl: string, round: number) {
    return fetch(`${baseUrl}/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body(round)),
    });
  }

  it("answers 429 once a caller exceeds the limit", async () => {
    const app = createApp({ jevConfig, rateLimit: { limit: 1, windowMs: 60_000 } });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("no server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // Jev itself is unreachable here, so the first call falls back to the simulation - but it
      // still consumes the caller's quota, which is what we are asserting on.
      const first = await post(baseUrl, 1);
      expect(first.status).toBe(200);

      const second = await post(baseUrl, 2);
      expect(second.status).toBe(429);
      expect(second.headers.get("retry-after")).toBeTruthy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not limit anything when no key is configured", async () => {
    const app = createApp({ jevConfig: null, rateLimit: { limit: 1, windowMs: 60_000 } });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("no server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      expect((await post(baseUrl, 1)).status).toBe(200);
      expect((await post(baseUrl, 2)).status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
