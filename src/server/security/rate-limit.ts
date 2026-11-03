/**
 * Best-effort fixed-window rate limiter for /api/v1, used from the edge middleware.
 *
 * LIMITS OF THIS DESIGN (be honest about them): counters live in the memory of ONE server instance. Behind a
 * serverless host every cold instance starts at zero and instances do not share state, and the client address
 * comes from X-Forwarded-For, which is only trustworthy behind your own proxy/CDN. So this slows down scripts and
 * accidents; it is NOT a defence against a determined or distributed attacker. Real protection belongs at the edge
 * (Cloudflare / Vercel WAF rate-limit rules + CAPTCHA) - see docs/DEPLOYMENT.md. The database separately throttles
 * Help Me Find It per phone and user, and Supabase Auth rate-limits sign-in and sign-up.
 */
export type LimitClass = "read" | "write" | "sensitive";

export interface LimitConfig {
  windowMs: number;
  read: number;
  write: number;
  sensitive: number;
}

export const DEFAULT_LIMITS: LimitConfig = { windowMs: 60_000, read: 240, write: 60, sensitive: 20 };

/** Reads limits from env strings (invalid or missing values fall back to the defaults). */
export function limitsFromEnv(env: Record<string, string | undefined>): LimitConfig {
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  return {
    windowMs: DEFAULT_LIMITS.windowMs,
    read: num(env.API_RATE_LIMIT_READ, DEFAULT_LIMITS.read),
    write: num(env.API_RATE_LIMIT_WRITE, DEFAULT_LIMITS.write),
    sensitive: num(env.API_RATE_LIMIT_SENSITIVE, DEFAULT_LIMITS.sensitive),
  };
}

/** Anonymous endpoints that can be used to probe or flood people's data get the tightest bucket. */
export function classify(method: string, pathname: string): LimitClass {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "read";
  if (pathname.startsWith("/api/v1/help-me-find-it") || pathname.startsWith("/api/v1/waitlist")) return "sensitive";
  return "write";
}

export interface Decision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const MAX_KEYS = 10_000;

export function createRateLimiter(config: LimitConfig, now: () => number = Date.now) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  function sweep(t: number) {
    for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
    // Still too many distinct callers: drop the oldest entries rather than grow without bound.
    if (buckets.size > MAX_KEYS) {
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (buckets.size <= MAX_KEYS / 2) break;
      }
    }
  }

  return {
    check(clientKey: string, cls: LimitClass): Decision {
      const t = now();
      if (buckets.size > MAX_KEYS) sweep(t);
      const key = `${cls}:${clientKey}`;
      const limit = config[cls];
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + config.windowMs };
        buckets.set(key, b);
      }
      b.count += 1;
      return {
        allowed: b.count <= limit,
        limit,
        remaining: Math.max(0, limit - b.count),
        retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - t) / 1000)),
      };
    },
    size: () => buckets.size,
  };
}

/** First hop of X-Forwarded-For (set by your proxy), else X-Real-IP, else a shared "unknown" bucket. */
export function clientKeyFrom(headers: { get(name: string): string | null }): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (fwd || headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}