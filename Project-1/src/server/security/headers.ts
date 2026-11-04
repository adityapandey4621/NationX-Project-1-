/** Security response headers (OWASP secure-headers baseline) for every page and API response. */
export interface HeaderEntry {
  key: string;
  value: string;
}

function origin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy. Next.js injects inline bootstrap scripts, so `script-src` needs 'unsafe-inline'
 * until nonce-based CSP is adopted (a middleware change; listed as a hardening follow-up). Everything else is
 * locked to this site and the configured Supabase project (images from Storage, auth/REST calls).
 */
export function contentSecurityPolicy(env: { supabaseUrl?: string; dev?: boolean }): string {
  const supa = origin(env.supabaseUrl);
  const supaWs = supa ? supa.replace(/^http/, "ws") : null;
  const list = (...v: (string | null | false | undefined)[]) => v.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src ${list("'self'", "'unsafe-inline'", env.dev && "'unsafe-eval'")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${list("'self'", "data:", "blob:", supa)}`,
    "font-src 'self' data:",
    `connect-src ${list("'self'", supa, supaWs, env.dev && "ws:")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(env: { supabaseUrl?: string; dev?: boolean }): HeaderEntry[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Geolocation is used by the application form's "use my location"; camera/microphone/payment never.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), geolocation=(self)" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}