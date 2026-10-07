import {afterEach,describe,expect,it,vi} from "vitest";
import { CITIZEN_COUNT } from "../shared/citizens.ts";
import { createApp } from "../server/app.ts";
import { loadJevConfig, readVisitorKey } from "../server/jevClient.ts";

const VISITOR_KEY = "sk-visitor-secret-value-1234";
const realFetch=globalThis.fetch;
afterEach(()=>vi.unstubAllGlobals());
function stubJev() {
  // The routes are real local HTTP. Only the remote provider is simulated;
  // credential and quota checks must not depend on an external service.
  const upstream=vi.fn(async(_request:RequestInfo|URL,_init?:RequestInit)=>new Response(JSON.stringify({model:'jev-offline-test',answers:{},provider_debug:{echo:VISITOR_KEY}}),{status:200}));
  vi.stubGlobal('fetch',upstream);return upstream;
}

function body(round: number) {
  return {
    broadcast: "Test broadcast",
    round,
    unrest: 0,
    history: [],
    citizens: Array.from({ length: CITIZEN_COUNT }, (_, i) => ({ id: i + 1, lastAction: null })),
  };
}

async function withServer<T>(app: ReturnType<typeof createApp>, run: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function post(baseUrl: string, round: number, key?: string) {
  return realFetch(`${baseUrl}/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      ...(key ? { "x-typesafe-key": key } : {}),
    },
    body: JSON.stringify(body(round)),
  });
}

describe("readVisitorKey", () => {
  it("accepts a key-shaped header and trims it", () => {
    expect(readVisitorKey(`  ${VISITOR_KEY}  `)).toBe(VISITOR_KEY);
  });

  it("rejects anything that is not key-shaped", () => {
    expect(readVisitorKey("short")).toBeNull();
    expect(readVisitorKey("has whitespace in the middle")).toBeNull();
    expect(readVisitorKey("k".repeat(400))).toBeNull();
    expect(readVisitorKey(undefined)).toBeNull();
    expect(readVisitorKey(123)).toBeNull();
  });
});

describe("bring-your-own-key", () => {
  it("serves the simulation when the deployment has no key and none is supplied", async () => {
    await withServer(createApp({ jevConfig: null, rateLimit: null }), async (baseUrl) => {
      const res = await post(baseUrl, 1);
      expect(res.status).toBe(200);
      const payload = await res.json();
      expect(payload.mode).toBe("simulation");
      expect(payload.decisions).toHaveLength(CITIZEN_COUNT);
    });
  });

  it("never echoes the visitor key back to the client", async () => {
    const upstream=stubJev();
    await withServer(createApp({ jevConfig: null, rateLimit: null }), async (baseUrl) => {
      const res = await post(baseUrl, 1, VISITOR_KEY);
      const text = await res.text();
      expect(text).not.toContain(VISITOR_KEY);
      expect(res.headers.get("x-typesafe-key")).toBeNull();
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((upstream.mock.calls[0]![1]!.headers as Record<string,string>).Authorization).toBe(`Bearer ${VISITOR_KEY}`);
  });

  it("does not spend the deployment's rate limit on a visitor's own key", async () => {
    // The limit exists to protect the server key; a visitor paying for their own
    // rounds should not be throttled by it.
    const upstream=stubJev();
    await withServer(
      createApp({ jevConfig: {apiKey:'deployment-test-key',baseUrl:'https://provider.example.invalid',model:'jev-test',timeoutMs:50}, rateLimit: { limit: 1, windowMs: 60_000 } }),
      async (baseUrl) => {
        for (let round = 1; round <= 4; round += 1) {
          const res = await post(baseUrl, round, VISITOR_KEY);
          expect(res.status).toBe(200);
          await res.arrayBuffer();
        }
        expect(upstream).toHaveBeenCalledTimes(4);
        for(const call of upstream.mock.calls)expect((call[1]!.headers as Record<string,string>).Authorization).toBe(`Bearer ${VISITOR_KEY}`);
        expect((await post(baseUrl,5)).status).toBe(200);
        expect((await post(baseUrl,6)).status).toBe(429);
      },
    );
  });

  it("still throttles callers relying on the deployment's key", async () => {
    stubJev();
    const jevConfig = {
      apiKey: "server-key",
      baseUrl: "https://api.example.invalid",
      model: "jev-test",
      timeoutMs: 50,
    };
    await withServer(createApp({ jevConfig, rateLimit: { limit: 1, windowMs: 60_000 } }), async (baseUrl) => {
      expect((await post(baseUrl, 1)).status).toBe(200);
      expect((await post(baseUrl, 2)).status).toBe(429);
    });
  });
});

describe("hosted deployments ignore the owner's key by default", () => {
  const key = { TYPESAFE_API_KEY: "server-key-value-1234567890" } as NodeJS.ProcessEnv;

  it("uses the key when running locally", () => {
    expect(loadJevConfig(key)).not.toBeNull();
  });

  it("ignores the key when running on Vercel", () => {
    expect(loadJevConfig({ ...key, VERCEL: "1" })).toBeNull();
  });

  it("uses it on Vercel only when explicitly opted in", () => {
    expect(loadJevConfig({ ...key, VERCEL: "1", JEV_ALLOW_SERVER_KEY: "true" })).not.toBeNull();
    expect(loadJevConfig({ ...key, VERCEL: "1", JEV_ALLOW_SERVER_KEY: "yes" })).toBeNull();
  });
});
