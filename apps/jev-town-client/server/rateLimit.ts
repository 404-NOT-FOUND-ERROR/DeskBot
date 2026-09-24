/**
 * A small fixed-window rate limiter for the broadcast endpoint.
 *
 * The public deployment calls Jev with the site owner's API key, so without a
 * limit any visitor could spend that quota in a loop. This keeps counts in
 * memory, which on a serverless host means per running instance rather than
 * globally: it is a brake on casual abuse, not a security control. For a hard
 * guarantee, put a shared store or the platform's own WAF in front of it.
 */

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Injected in tests. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/** Requests per IP per hour, overridable with BROADCAST_RATE_LIMIT (0 disables the limit). */
export function rateLimitFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimitOptions | null {
  const raw = env.BROADCAST_RATE_LIMIT?.trim();
  const limit = raw === undefined || raw === "" ? 60 : Number(raw);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return { limit, windowMs: 60 * 60 * 1000 };
}

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimitOptions) {
  const windows = new Map<string, Window>();

  return function take(key: string): RateLimitResult {
    const time = now();
    const existing = windows.get(key);

    if (!existing || existing.resetAt <= time) {
      // Opportunistic cleanup: expired keys would otherwise pile up on a long-lived instance.
      for (const [otherKey, window] of windows) {
        if (window.resetAt <= time) windows.delete(otherKey);
      }
      windows.set(key, { count: 1, resetAt: time + windowMs });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - time) / 1000));
    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    existing.count += 1;
    return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
  };
}
