import { afterEach, describe, expect, it, vi } from "vitest";
import { CITIZEN_COUNT, questionIdFor } from "../shared/citizens.ts";
import { createApp } from "../server/app.ts";
import type { JevConfig } from "../server/jevClient.ts";

function validCitizens() {
  return Array.from({ length: CITIZEN_COUNT }, (_, i) => ({ id: i + 1, lastAction: null }));
}

async function withServer<T>(
  jevConfig: JevConfig | null,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = createApp({ jevConfig });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no server address");

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// Captured once, before any test stubs `globalThis.fetch` to intercept the
// server's outbound call to Jev. Tests must use this (not the bare global) to
// talk to their own local test server, or they would intercept themselves.
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("GET /api/status", () => {
  it("reports jevConfigured: false when no config is supplied", async () => {
    await withServer(null, async (baseUrl) => {
      const res = await realFetch(`${baseUrl}/api/status`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ jevConfigured: false, model: "local-simulation", citizenCount: CITIZEN_COUNT });
    });
  });

  it("reports jevConfigured: true and the configured model when a key is present", async () => {
    await withServer(
      { apiKey: "secret", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1000 },
      async (baseUrl) => {
        const res = await realFetch(`${baseUrl}/api/status`);
        const body = await res.json();
        expect(body.jevConfigured).toBe(true);
        expect(body.model).toBe("jev-latest");
      },
    );
  });
});

describe("POST /api/broadcast", () => {
  it("rejects a malformed request with 422 and never touches the network", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await withServer(
      { apiKey: "secret", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1000 },
      async (baseUrl) => {
        const res = await realFetch(`${baseUrl}/api/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ broadcast: "", round: 1, unrest: 0, history: [], citizens: validCitizens() }),
        });
        expect(res.status).toBe(422);
        const body = await res.json();
        expect(body.error).toBeTruthy();
        expect(Array.isArray(body.details)).toBe(true);
      },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the local simulation and returns a decision for every citizen when no key is configured", async () => {
    await withServer(null, async (baseUrl) => {
      const res = await realFetch(`${baseUrl}/api/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          broadcast: "Free bread at the bakery!",
          round: 1,
          unrest: 0,
          history: [],
          citizens: validCitizens(),
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mode).toBe("simulation");
      expect(body.filledLocally).toBe(CITIZEN_COUNT);
      expect(body.decisions).toHaveLength(CITIZEN_COUNT);
      for (const decision of body.decisions) {
        expect(["IGNORE", "INVESTIGATE", "JOIN", "FLEE", "WARN"]).toContain(decision.action);
      }
    });
  });

  it("calls Jev with an Authorization header and maps a real response, without ever echoing the key", async () => {
    let capturedAuth: string | null = null;

    globalThis.fetch = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>).Authorization ?? null;
      const answers: Record<string, unknown> = {};
      for (let i = 1; i <= CITIZEN_COUNT; i++) {
        answers[questionIdFor(i)] = {
          type: "choice",
          choice: "IGNORE",
          confidence: 0.9,
          probabilities: { IGNORE: 0.9, INVESTIGATE: 0.025, JOIN: 0.025, FLEE: 0.025, WARN: 0.025 },
        };
      }
      return new Response(
        JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 500, output_tokens: 40 } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    await withServer(
      { apiKey: "top-secret-key", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1000 },
      async (baseUrl) => {
        const res = await realFetch(`${baseUrl}/api/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            broadcast: "Routine announcement.",
            round: 1,
            unrest: 0,
            history: [],
            citizens: validCitizens(),
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe("jev");
        expect(body.model).toBe("jev-1.13.0");
        expect(body.filledLocally).toBe(0);
        expect(body.decisions).toHaveLength(CITIZEN_COUNT);
        expect(body.decisions[0].action).toBe("IGNORE");
      },
    );

    expect(capturedAuth).toBe("Bearer top-secret-key");
  });

  it("falls back to simulation when Jev errors, and reports why without leaking the key", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;

    await withServer(
      { apiKey: "top-secret-key", baseUrl: "https://api.typesafe.ai", model: "jev-latest", timeoutMs: 1000 },
      async (baseUrl) => {
        const res = await realFetch(`${baseUrl}/api/broadcast`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            broadcast: "Routine announcement.",
            round: 1,
            unrest: 0,
            history: [],
            citizens: validCitizens(),
          }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe("simulation");
        expect(body.reason).toMatch(/401/);
        expect(body.reason).not.toMatch(/top-secret-key/);
        expect(body.decisions).toHaveLength(CITIZEN_COUNT);
      },
    );
  });
});
