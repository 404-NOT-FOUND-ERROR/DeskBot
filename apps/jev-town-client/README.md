# DeskBot Jev Town world client

This directory is the DeskBot world client derived from [CeciliaW888/jev-town](https://github.com/CeciliaW888/jev-town). DeskBot integration mode is the maintained product path; the original town-crier simulation remains as upstream reference code. DeskBot service owns canonical world state, validation and persistence. See [AUTHORIZATION.md](AUTHORIZATION.md) and the repository-level [adoption record](../../documentation/jev-town-adoption.md).

Start DeskBot mode with `npm run dev:deskbot` and open:

```text
http://127.0.0.1:5173/?mode=deskbot&deskbotUrl=http://127.0.0.1:4311
```

## Upstream project description

You are the Town Crier of a small 3D town. Write one broadcast and all 50 citizens decide, in parallel, whether to **investigate**, **join**, **flee**, **warn**, or **ignore** it.

Play it at <https://jev-town.vercel.app>.

The hosted demo runs on the built-in simulation so that it costs nothing to share.
A deployment ignores its own `TYPESAFE_API_KEY` unless `JEV_ALLOW_SERVER_KEY=true` is set, so a public URL never spends the owner's quota on anonymous visitors.
To see real Jev decisions, add your own key in the app or run it locally - both are described below.

The game uses one batched Jev `choice` request per round. Every citizen has a distinct role and personality, so the same announcement can split the town in surprising ways. Your directive changes each round. Balance trust and unrest while building a streak.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
TYPESAFE_API_KEY="$(<~/.config/typesafe/api_key)" npm run dev
```

Open <http://localhost:5173>.

The key is read only by the local Express backend on port `8787`; it is never sent to the browser. If the key is missing or Jev is unavailable, the game remains playable with a clearly labelled deterministic simulation fallback.

## Bring your own key

The game needs a Jev API key to produce real decisions.
There are two ways to supply one, and neither exposes a key to anyone else.

**Run it locally.** Clone the repo and pass your key to the local server, as shown above.
The key stays in your shell environment, is read only by the Express backend, and is never sent to the browser.
This is the right option if you would rather not paste a key into a website.

**Add a key in the hosted app.** When the deployment carries no key of its own, the app offers an "Add key" box.
The key is held in `sessionStorage` for that tab only, is sent to this app's own API, and is forwarded once to Jev.
It is never stored on the server, never written to a log, and never returned in a response - `tests/byok.test.ts` asserts the last of those.
Closing the tab discards it.

Get a key at <https://typesafe.ai>.

Rounds played on a visitor's own key are not counted against the deployment's rate limit, because that limit exists to protect the deployment's key rather than the visitor's.

## Play

1. Read the round directive and its two hidden-in-plain-sight scoring goals.
2. Write a town-wide broadcast, or choose a prompt chip.
3. Watch all 50 citizens walk the streets of a 3D town according to their typed Jev decision.
4. Use the result chart and citizen confidence indicators to tune your next broadcast.
5. Keep trust above zero and unrest below 100 for six rounds.

## Verification

```bash
npm test
npm run build
```

The test suite covers scoring, reducer state, fallback determinism, request validation, response mapping, API-key isolation, rate limiting, street routing, and the exact five-action Jev schema.

## Live site

<https://jev-town.vercel.app> runs the real thing: every round is a live Jev call.

The Vercel deployment serves the same Express API as a serverless function, so `TYPESAFE_API_KEY` stays on the server and is never bundled into the browser build.
`npm run build:vercel` (see `scripts/build-vercel.mjs`) emits the deployment through Vercel's Build Output API: the Vite client as static files, plus one bundled Node function at `api/[...path]`.
Two constraints make that the right shape rather than a zero-config `api/` directory.
Vercel detects zero-config functions from the cloned source before the build command runs, so a generated function is never picked up.
It also compiles each function file on its own, which leaves this project's explicit `.ts` import specifiers in the emitted JavaScript, where Node cannot resolve them.

Pushes to `main` deploy automatically, because the Vercel project is connected to this GitHub repository.
Note that `vercel git connect` cannot parse an SSH host alias such as `git@github-cecilia:...`; point `origin` at the plain `https://github.com/...` URL while connecting if you ever need to redo it.

Deploying from a fresh clone, or by hand:

```bash
vercel login
vercel link
vercel env add TYPESAFE_API_KEY production < ~/.config/typesafe/api_key
vercel --prod
```

Because the hosted site spends the site owner's Jev quota, `/api/broadcast` is rate limited to 60 broadcasts per IP per hour.
Set `BROADCAST_RATE_LIMIT` to another number to change that, or to `0` to switch it off.
The limit is counted in memory per serverless instance, so treat it as a brake on casual abuse rather than a hard guarantee.

## Public demo

The GitHub Pages build runs the deterministic simulation, because a static site cannot keep an API key secret.
It is labelled **Simulation** in the interface.
Use the Vercel site above, or run the project locally with `TYPESAFE_API_KEY`, to play with real Jev decisions.

## Architecture and decisions

[ARCHITECTURE.md](ARCHITECTURE.md) explains the stack, the decisions behind the game (why one batched Jev call, why the key never reaches the browser, why the citizens are stylised rather than realistic), and the terminology those decisions use.

## Architecture

- `src/`: React/Vite game UI; `src/three/` renders the town in Three.js (merged low-poly scenery, walking citizens, orbit/pan/zoom camera)
- `server/`: Express API, Jev adapter, validation, rate limiting, and fallback simulation
- `server/vercel.ts`: Vercel serverless entry point, bundled into `api/` at build time
- `shared/`: citizens, action schema, scoring, street-grid town layout and routing, and wire protocol
- `tests/`: Vitest suite

## DeskBot world-client integration

The `?mode=deskbot` entry keeps this project's visual baseline while reading the DeskBot canonical map and life Scene. It does not import the original 50 citizens into DeskBot, and it does not own a second world state.

Start a DeskBot service with a disposable database, then open for example:

```text
http://localhost:5173/?mode=deskbot&deskbotUrl=http://127.0.0.1:4411
```

NPC actions are shown as proposals first. Confirmation re-reads the world revision, current NPC location, and adjacency before posting a normal `npc_action` to DeskBot `/api/event`; DeskBot remains the final validator and persistent ledger owner.

The DeskBot project owner reports direct confirmation from this project's developer that the source and bundled assets may be modified and redistributed for the DeskBot derivative. See [AUTHORIZATION.md](AUTHORIZATION.md) for the recorded scope and release checklist; preserve the developer's written confirmation with the derivative release.

One server request sends 50 typed `choice` questions to Jev. The response is validated and mapped back to the matching citizen. Invalid or missing answers are filled locally so a partial model response cannot break the round.
