import { isIP } from "node:net";
import { getEnv } from "./env";

/**
 * In-memory fixed-window rate limiter. Right for a single Node process behind
 * one reverse proxy; for more than one instance, swap the store for a shared
 * one without changing the call sites.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (buckets.size > MAX_BUCKETS) purge(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

function purge(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still huge (a flood of distinct keys inside one window): start over rather
  // than let memory grow without bound.
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

/**
 * The client's address as reported by the reverse proxy in front of the app.
 *
 * Which header to believe depends on your proxy, so it is configurable
 * (CLIENT_IP_HEADER). For `x-forwarded-for` the LAST entry is used: that is
 * the one appended by your own proxy, whereas earlier entries can be written
 * by the client. Behind a CDN that sets its own header (for example
 * `cf-connecting-ip`), name that header instead. If the app is reachable
 * without a proxy, these headers can be forged and per-IP limits are weaker.
 */
export function clientIp(headers: Headers): string {
  const name = getEnv().CLIENT_IP_HEADER;
  const raw = headers.get(name);
  if (!raw) return "unknown";
  const candidate = name === "x-forwarded-for" ? raw.split(",").pop()!.trim() : raw.trim();
  return isIP(candidate) ? candidate : "unknown";
}
