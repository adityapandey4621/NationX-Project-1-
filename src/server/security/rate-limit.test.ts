import { describe, expect, it } from "vitest";
import { classify, clientKeyFrom, createRateLimiter, DEFAULT_LIMITS, limitsFromEnv } from "./rate-limit";

const cfg = { windowMs: 1000, read: 3, write: 2, sensitive: 1 };

describe("rate limiter", () => {
  it("allows up to the limit, then refuses with a retry hint", () => {
    const t = 0;
    const l = createRateLimiter(cfg, () => t);
    expect([l.check("a", "read"), l.check("a", "read"), l.check("a", "read")].every((d) => d.allowed)).toBe(true);
    const over = l.check("a", "read");
    expect(over).toMatchObject({ allowed: false, remaining: 0, limit: 3 });
    expect(over.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
  it("keeps callers and classes separate", () => {
    const l = createRateLimiter(cfg, () => 0);
    l.check("a", "sensitive");
    expect(l.check("a", "sensitive").allowed).toBe(false);
    expect(l.check("b", "sensitive").allowed).toBe(true);
    expect(l.check("a", "read").allowed).toBe(true);
  });
  it("starts a fresh window after it expires", () => {
    let t = 0;
    const l = createRateLimiter(cfg, () => t);
    l.check("a", "write"); l.check("a", "write");
    expect(l.check("a", "write").allowed).toBe(false);
    t = 1001;
    expect(l.check("a", "write").allowed).toBe(true);
  });
  it("does not grow without bound under many distinct callers", () => {
    const t = 0;
    const l = createRateLimiter(cfg, () => t);
    for (let i = 0; i < 25_000; i++) l.check(`ip-${i}`, "read");
    expect(l.size()).toBeLessThanOrEqual(10_001 + 1);
  });
});

describe("classification and configuration", () => {
  it("reads are cheap, writes tighter, anonymous request lookups tightest", () => {
    expect(classify("GET", "/api/v1/discovery/search")).toBe("read");
    expect(classify("POST", "/api/v1/merchant/applications")).toBe("write");
    expect(classify("POST", "/api/v1/help-me-find-it")).toBe("sensitive");
    expect(classify("POST", "/api/v1/help-me-find-it/track")).toBe("sensitive");
    expect(classify("GET", "/api/v1/help-me-find-it")).toBe("read");
    expect(classify("POST", "/api/v1/waitlist")).toBe("sensitive");
    expect(classify("POST", "/api/v1/waitlist/leave")).toBe("sensitive");
    expect(classify("GET", "/api/v1/waitlist/demand")).toBe("read");
  });
  it("falls back to defaults for missing or invalid settings", () => {
    expect(limitsFromEnv({})).toEqual(DEFAULT_LIMITS);
    expect(limitsFromEnv({ API_RATE_LIMIT_READ: "abc", API_RATE_LIMIT_WRITE: "-4", API_RATE_LIMIT_SENSITIVE: "7" })).toMatchObject({ read: DEFAULT_LIMITS.read, write: DEFAULT_LIMITS.write, sensitive: 7 });
  });
  it("takes the client from the first forwarded hop", () => {
    const h = (v: Record<string, string>) => ({ get: (n: string) => v[n] ?? null });
    expect(clientKeyFrom(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientKeyFrom(h({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientKeyFrom(h({}))).toBe("unknown");
  });
});