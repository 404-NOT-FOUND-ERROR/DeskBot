/**
 * Builds the Vercel deployment using the Build Output API.
 *
 * Why not the zero-config `api/` directory: Vercel detects those functions
 * from the cloned source *before* the build command runs, so a function that
 * the build generates is never picked up. It also compiles each file on its
 * own, which leaves this project's explicit `.ts` import specifiers in the
 * emitted JavaScript, where Node cannot resolve them.
 *
 * So the build emits the deployment itself: the Vite client into
 * `.vercel/output/static`, and the same Express app as `npm run dev` bundled
 * behind one function per API route. A function per route keeps the request
 * path intact, which Express needs to match on - the Build Output API has no
 * filename-based catch-all, and rewriting everything to a single function
 * would hand Express the rewritten path instead of the real one.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, ".vercel", "output");
/** One function per route the Express app serves; see `server/app.ts`. */
const API_ROUTES = ["status", "broadcast"];

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });

rmSync(output, { recursive: true, force: true });

// 1. The browser build, copied in as the deployment's static files.
run("npm", ["run", "build:client"]);
mkdirSync(output, { recursive: true });
cpSync(join(root, "dist"), join(output, "static"), { recursive: true });

// 2. The API, bundled once so each function is self-contained: no `.ts`
//    specifiers and no reliance on node_modules being present at runtime.
const bundle = join(output, "api-bundle.js");
run("npx", [
  "esbuild",
  "server/vercel.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--target=node22",
  `--outfile=${bundle}`,
]);

for (const route of API_ROUTES) {
  const funcDir = join(output, "functions", "api", `${route}.func`);
  mkdirSync(funcDir, { recursive: true });
  cpSync(bundle, join(funcDir, "index.js"));
  // The repo is ESM ("type": "module"), so mark this CommonJS bundle explicitly
  // rather than relying on whatever package.json the runtime resolves to.
  writeFileSync(join(funcDir, "package.json"), `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`);
  writeFileSync(
    join(funcDir, ".vc-config.json"),
    `${JSON.stringify(
      {
        runtime: "nodejs22.x",
        handler: "index.js",
        launcherType: "Nodejs",
        shouldAddHelpers: true,
        // Jev's own client timeout is 20s; leave headroom above it.
        maxDuration: 30,
      },
      null,
      2,
    )}\n`,
  );
}
rmSync(bundle, { force: true });

// 3. Routing: everything else falls through to the static files.
writeFileSync(
  join(output, "config.json"),
  `${JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }] }, null, 2)}\n`,
);

console.log(`[build-vercel] wrote .vercel/output (static + ${API_ROUTES.length} api functions)`);
