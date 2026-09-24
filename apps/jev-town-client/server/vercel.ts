/**
 * Vercel entry point for the API. The same Express app that `npm run dev`
 * serves on port 8787 is exported as a serverless function, so the hosted
 * deployment and local development run identical request handling - and
 * TYPESAFE_API_KEY stays on the server in both.
 *
 * `npm run build:api` bundles this file to `api/[...path].js`, a catch-all
 * that covers every /api/* route the app defines (`/api/status` and
 * `/api/broadcast`); Express matches them from the original URL. The bundle
 * step matters: Vercel compiles each function file on its own without
 * following it, so the project's explicit `.ts` import specifiers would
 * otherwise survive into the runtime, where Node cannot resolve them.
 */
import { createApp } from "./app.ts";

export default createApp();
