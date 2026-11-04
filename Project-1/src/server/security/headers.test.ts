import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./headers";

describe("security headers", () => {
  const csp = contentSecurityPolicy({ supabaseUrl: "https://abc.supabase.co/", dev: false });
  it("locks the page to itself and the configured Supabase origin", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://abc.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
  it("allows eval only in development", () => {
    expect(csp).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
  });
  it("tolerates a missing or malformed Supabase URL", () => {
    expect(contentSecurityPolicy({})).toContain("connect-src 'self'");
    expect(contentSecurityPolicy({ supabaseUrl: "not a url" })).not.toContain("not a url");
  });
  it("includes the standard hardening headers", () => {
    const keys = securityHeaders({ dev: false }).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]));
  });
});