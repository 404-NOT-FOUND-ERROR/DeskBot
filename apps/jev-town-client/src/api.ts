import type { Action } from "@shared/actions.ts";
import { CITIZEN_COUNT } from "@shared/citizens.ts";
import {
  broadcastResponseSchema,
  statusResponseSchema,
  type BroadcastResponse,
  type StatusResponse,
} from "@shared/protocol.ts";
import { simulateLocation } from "@shared/locations.ts";
import { simulateAllDecisions } from "@shared/simulation.ts";

const IS_STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "true";

/** Header the server reads a visitor-supplied key from. */
const VISITOR_KEY_HEADER = "x-typesafe-key";
const VISITOR_KEY_STORAGE = "jev-town:key";

/**
 * A visitor's own key lives in `sessionStorage` and nowhere else: it is gone
 * when the tab closes, is never written to `localStorage`, and is sent only to
 * this app's own `/api/broadcast`, which forwards it to Jev without storing it.
 */
export function readVisitorKey(): string | null {
  try {
    return sessionStorage.getItem(VISITOR_KEY_STORAGE);
  } catch {
    return null; // private mode, or storage blocked
  }
}

export function storeVisitorKey(key: string | null): void {
  try {
    if (key) sessionStorage.setItem(VISITOR_KEY_STORAGE, key);
    else sessionStorage.removeItem(VISITOR_KEY_STORAGE);
  } catch {
    // Not being able to remember the key is survivable; the round still works.
  }
}

export async function fetchStatus(): Promise<StatusResponse> {
  if (IS_STATIC_DEMO) {
    return { jevConfigured: false, model: "static-simulation", citizenCount: CITIZEN_COUNT };
  }

  const res = await fetch("/api/status");
  if (!res.ok) throw new Error(`Status check failed (HTTP ${res.status})`);
  return statusResponseSchema.parse(await res.json());
}

export interface BroadcastPayload {
  broadcast: string;
  round: number;
  unrest: number;
  history: string[];
  citizens: { id: number; lastAction: Action | null }[];
}

export async function postBroadcast(payload: BroadcastPayload): Promise<BroadcastResponse> {
  if (IS_STATIC_DEMO) {
    const started = performance.now();
    const decisions = simulateAllDecisions(payload.broadcast, payload.round);
    return {
      mode: "simulation",
      reason: "GitHub Pages cannot keep API keys secret, so this public version uses the local simulation.",
      locationId: simulateLocation(payload.broadcast),
      latencyMs: Math.round(performance.now() - started),
      filledLocally: decisions.length,
      decisions,
    };
  }

  const visitorKey = readVisitorKey();
  const res = await fetch("/api/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(visitorKey ? { [VISITOR_KEY_HEADER]: visitorKey } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `Broadcast failed (HTTP ${res.status})`;
    try {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).error === "string") {
        message = (body as Record<string, unknown>).error as string;
      }
    } catch {
      // Response body wasn't JSON; fall back to the generic message above.
    }
    throw new Error(message);
  }

  return broadcastResponseSchema.parse(await res.json());
}
