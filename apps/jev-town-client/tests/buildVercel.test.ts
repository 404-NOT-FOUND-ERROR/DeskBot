import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../server/app.ts";

/**
 * The Vercel build emits one serverless function per API route, so a route
 * added to the Express app but not to that list would 404 in production while
 * working perfectly in local development. This keeps the two in step.
 */
function routesFromApp(): string[] {
  const app = createApp({ jevConfig: null }) as unknown as {
    router: { stack: Array<{ route?: { path: string } }> };
  };
  return app.router.stack
    .map((layer) => layer.route?.path)
    .filter((path): path is string => typeof path === "string" && path.startsWith("/api/"))
    .map((path) => path.slice("/api/".length))
    .sort();
}

function routesFromBuildScript(): string[] {
  const source = readFileSync(new URL("../scripts/build-vercel.mjs", import.meta.url), "utf8");
  const match = /const API_ROUTES = \[([^\]]*)\]/.exec(source);
  if (!match?.[1]) throw new Error("API_ROUTES not found in scripts/build-vercel.mjs");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string).sort();
}

describe("Vercel build output", () => {
  it("emits a function for exactly the routes the Express app serves", () => {
    const appRoutes = routesFromApp();
    expect(appRoutes.length).toBeGreaterThan(0);
    expect(routesFromBuildScript()).toEqual(appRoutes);
  });
});
