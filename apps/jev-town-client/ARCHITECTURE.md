# Jev Town: architecture and decisions

This document explains what the game is, the stack it runs on, the decisions behind it, and the vocabulary those decisions use.
Read it before changing the town, the citizens or the deployment: most of what looks arbitrary here is a deliberate trade-off, and the reasoning is recorded so it can be argued with rather than guessed at.

## What the game is

You are the Town Crier of Cloverfield.
Each round you write one broadcast to the whole town, and all fifty citizens decide, independently and in parallel, how to react.
Each of them picks exactly one of five actions: **ignore**, **investigate**, **join in**, **flee home**, or **warn others**.

Every citizen has a name, a role, a one-sentence personality, a home and a workplace, so the same announcement splits the town in ways that make sense afterwards.
A round directive sets goals ("get at least ten citizens to investigate"), and your score, trust and unrest follow from how the town actually reacted.
The town then walks to wherever its decisions send it: joiners crowd the fountain, warners run to the watchtower, the frightened go home.

The point of the game is the moment the answers land: one call, fifty typed decisions, under a second.

## The stack

| Layer | Choice | Why |
| --- | --- | --- |
| Decisions | [Jev](https://typesafe.ai) via `POST /v1/systemone` | A decision model: it returns typed choices, not prose, and answers all fifty citizens in one batched request |
| UI | React 19 + TypeScript 5.9 | Game state is a reducer; the 3D scene is deliberately outside React (see below) |
| 3D | Three.js 0.186 | Direct scene-graph use, no React renderer, so the render loop never re-renders React |
| Build/dev | Vite 7 | Dev server with hot reload; production client build |
| API | Express 5 + Zod 4 | One small app, shared by local development and the deployment, with schema validation at the edge |
| Tests | Vitest 5 | Node-environment unit tests over the pure modules and the API |
| Hosting | Vercel (Build Output API) | Serves the client and runs the API as serverless functions, keeping the API key server-side |
| Demo | GitHub Pages | Static build with the offline simulation, since a static site cannot hold a secret |

### Layout

- `shared/` - the rules, and everything both sides need: citizens, actions, town layout, street routing, scoring, directives, wire protocol. Pure and dependency-free, so it is testable on its own.
- `server/` - the Express API, the Jev client, the rate limiter, and the offline simulation fallback.
- `src/` - the React UI. `src/three/` owns the 3D town.
- `scripts/build-vercel.mjs` - emits the deployment.
- `tests/` - Vitest suite.

## Architectural decisions

### DeskBot remains canonical in the integration mode

The optional DeskBot prototype treats this Three.js town as a projection and interaction surface. `GET /api/world/map` supplies locations, coordinates and NPCs; `GET /api/life/world` supplies the current Scene. The Jev Town browser does not copy its original 50-citizen simulation into DeskBot and does not claim proposed actions have occurred.

Before a proposed NPC action is submitted, the adapter fetches a fresh world map, rejects a stale revision or moved NPC, checks the destination against the NPC location's neighbors, and then sends a regular `npc_action` event. DeskBot performs the authoritative validation, persistence, idempotency and mutation-ledger write. This keeps the useful Jev pattern—choosing among typed legal actions—without allowing model prose or a browser broadcast to rewrite world facts.

### One batched Jev request per round

Every round sends a single request containing one `choice` question per citizen, sharing one `state` object (the broadcast, round, unrest, recent history, and every citizen's profile and last action).
Fifty separate requests would be slower and would lose the shared context.
The five action keys in `shared/actions.ts` are the exact option keys sent as `criteria`, so the wire format and the game rules cannot drift apart.

### Each question names its own citizen and its own announcement

Questions could point at shared state ("decide what the person in `citizens[7]` does about `broadcast`"), and at first they did.
Measured against six contrasting broadcasts, that phrasing let personality swamp the announcement: a burst dam produced more citizens joining in than fleeing, and wildly different broadcasts produced the same decision for a given citizen 69% of the time.

Two changes fixed it, each verified with live calls.
Stating the announcement and the listener inside every question took "flee or warn" on that disaster from 12 of 50 to 21.
Removing the roster from shared `state`, where all fifty profiles were repeated, took it to 29, and cut tokens as well: each question already names the one citizen it is about, so the copy in state only diluted the question.
Agreement across different broadcasts fell from 69% to 57%, meaning the town now reacts to what was actually said.

`tests/jevClient.test.ts` locks both properties in, because the failure is silent: the game still works, the citizens just stop listening.

### The API key never reaches the browser

`TYPESAFE_API_KEY` is read only by the server: locally by the Express process, in production by the serverless function.
The browser calls same-origin `/api/*` and never sees a key.
This is why the game has a backend at all for what is otherwise a static front end.

### Always playable without a key

If the key is missing, or Jev is unreachable, or a citizen is missing from the response, the server fills in from a deterministic local simulation and labels the round **Simulation** in the interface.
A partial model response can never break a round.

### The 3D scene lives outside React

`TownScene3D.tsx` owns the scene graph and the render loop imperatively.
Camera movement writes transforms straight onto DOM nodes for the citizen hit targets, so panning never triggers a React render.
React still owns game state, and the scene reacts to prop changes by mutating the existing objects rather than rebuilding them.

### Static scenery is merged into a few meshes

Hundreds of cottages, trees, road markings and grass tufts are baked into a handful of merged, vertex-coloured meshes at startup.
Without this, the town would be well over a thousand **draw calls**; with it, the static world costs about three.
The cost is that static scenery cannot move: anything that animates (citizens, the fountain, the bell) is built separately.

### The town is a street grid, and citizens walk it

The map is a 5 x 5 grid of blocks in a 120 x 120 space, grouped into four quarters around a central Fountain Square.
Citizens never cut diagonally through buildings: `shared/routes.ts` puts them on the nearest street, follows the grid with at most two turns, and steps off at the destination.
Fountain Square is the exception, because it is open paving and people cross it directly.

### Accessibility is real elements, not the canvas

A WebGL canvas is opaque to screen readers and to the keyboard.
So each citizen also has an invisible, focusable HTML button positioned over its figure every frame, carrying the citizen's name, role and last decision.
If WebGL is unavailable the game still works, with a text fallback in place of the map.

### The deployment is emitted, not detected

Vercel detects zero-config `api/` functions from the cloned source *before* the build command runs, so a function generated by the build is never picked up.
It also compiles each function file on its own, which leaves this project's explicit `.ts` import specifiers in the output, where Node cannot resolve them.
So `scripts/build-vercel.mjs` emits the deployment itself through the Build Output API: the client as static files, plus one bundled function per API route.
One function per route matters because the Build Output API has no filename-based catch-all, and rewriting everything to a single function would hand Express the rewritten path instead of the real one.
`tests/buildVercel.test.ts` ties that route list to the routes the Express app actually registers, so adding a route cannot silently 404 in production.

### The public site is rate limited

The hosted game spends the site owner's Jev quota, so `/api/broadcast` allows 60 broadcasts per IP per hour (`BROADCAST_RATE_LIMIT` to change, `0` to disable).
Counts are held in memory per serverless instance, so this is a brake on casual abuse, not a hard guarantee.

### Three.js loads separately

Three.js is most of the bundle, so the scene is lazy-loaded: the page, the broadcast bar and the game panel paint immediately, and the 3D town arrives as its own chunk.

### Citizens are stylised, not realistic

This is the decision that looks like a mistake and is not.

At the default camera a citizen is roughly twenty pixels tall.
The citizens are therefore about **four heads tall** rather than an adult's seven and a half.
A proportionally realistic figure at that size loses its head into the silhouette, and the head is what tells you that a shape is a person and which way it is facing.
Stylisation also covers what is missing: push toward realism and a viewer starts looking for faces, hands and cloth that a 20-pixel figure cannot have.
And it has to sit beside buildings that are plain blocks with no bricks or roof tiles, where accurate humans look misplaced rather than better.

This matches standard practice for small-figure city and simulation games, and the commercial and CC0 character packs such games are built from are stylised in the same range.

What *did* need fixing was the geometry, not the proportions.
The first version used cuboid limbs with flat shading, which read as toy bricks.
The citizens now have tapered torsos, capsule limbs with rounded shoulders, hips and knees, hands, shoes and hair, on smooth-shaded geometry, with varied height, build, skin tone and clothing.

Rejected alternative: importing a rigged character with motion-capture clips.
It would look better under heavy zoom, but Three.js cannot instance skinned meshes on WebGL, fifty of them is a real performance risk, and it pulls the citizens' art style away from the buildings.

### Labels appear by on-screen scale

Place labels are shown according to pixels per map unit, not zoom level, so a phone and a desktop show the same density of labels rather than a wall of overlapping pills.
Quarter names are always visible; workplaces, then homes, appear as you zoom in.

## Terminology

**Low-poly** - a model built from few polygons, with the facets left visible as part of the look rather than smoothed away.
Here it is both a style and a performance choice: simple shapes merge cheaply and read clearly when small.

**Stylised** - art that deliberately departs from real-world accuracy for legibility or character, as opposed to photorealistic art that aims to match reality.
Every choice in this town is stylised: the colours, the scale of buildings to people, the proportions of the citizens.

**Chibi** - a style with an oversized head on a small body, usually two to four heads tall, from the Japanese term for "short".
Our citizens sit at the restrained end of this: stylised proportions for legibility, without the exaggerated head and eyes of true chibi characters.

**Heads tall** - the standard way to describe body proportion: total height divided by head height.
A realistic adult is about 7.5; ours are about 4.

**Isometric / dimetric** - a way of viewing a 3D scene from a fixed angle where objects do not shrink with distance, giving the familiar "diorama" look of city-builder games.
The earlier version of this game faked it in CSS; the current one is a real 3D scene with an **orthographic camera**, which produces the same no-perspective effect while still allowing rotation and lighting.

**Orthographic camera** - a camera with no perspective: parallel lines stay parallel and distant objects stay the same size.
The opposite is a perspective camera, which is how a real lens or eye sees.

**Draw call** - one instruction from the browser to the GPU to draw something.
They are the usual bottleneck in a scene like this, which is why the static town is merged into a few meshes rather than left as hundreds of separate objects.

**Merged geometry / batching** - combining many separate shapes into one mesh so they draw together.
The trade-off is that a merged mesh moves as one thing, or not at all.

**Vertex colours** - colour stored per corner of the geometry rather than per material.
This is what lets hundreds of differently coloured cottages share a single material, and therefore merge.

**Flat vs smooth shading** - whether each facet gets one normal (hard-edged, faceted) or normals are blended across facets (rounded).
The buildings use flat shading deliberately; the citizens use smooth shading, because faceted limbs are exactly what made them look like toy bricks.

**Normal** - the direction a surface faces, used to work out how light hits it.

**Shadow map** - a texture the renderer uses to work out what is in shadow.
Bigger maps give crisper shadow edges at a memory cost.

**Tone mapping** - the step that converts high-range lighting values into displayable colour.
Filmic tone mapping here keeps sunlit roofs from clipping to flat white.

**Level of detail (LOD)** - showing less when something is small or far away.
This game applies the idea to labels rather than geometry.

**Rig / skinned mesh** - a skeleton inside a model, and a mesh that deforms with it.
This is how motion-capture animation is normally applied to characters; the citizens here are animated by rotating separate limb objects instead, which is cruder but far cheaper.

**CC0** - a licence dedicating work to the public domain, usable commercially with no attribution.
The relevant licence class if this project ever adopts external character assets; nothing in this repo currently uses third-party art.

**Serverless function** - server code that runs on demand, per request, with no server to maintain.
This is what holds the API key in production.

**Build Output API** - Vercel's low-level format for describing a finished deployment (static files plus functions), used here instead of letting Vercel infer the project's shape.
