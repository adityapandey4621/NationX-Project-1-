import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { classify, clientKeyFrom, createRateLimiter, limitsFromEnv } from "./server/security/rate-limit";

// One limiter per server instance (see rate-limit.ts for what this does and does not protect against).
let limiter: ReturnType<typeof createRateLimiter> | null = null;
let limits: ReturnType<typeof limitsFromEnv> | null = null;

function limitApi(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith("/api/v1/")) return null;
  limits ??= limitsFromEnv(process.env);
  limiter ??= createRateLimiter(limits);
  const d = limiter.check(clientKeyFrom(request.headers), classify(request.method, request.nextUrl.pathname));
  if (d.allowed) return null;
  return NextResponse.json(
    { success: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly." }, meta: { timestamp: new Date().toISOString() } },
    { status: 429, headers: { "Retry-After": String(d.retryAfterSeconds), "X-RateLimit-Limit": String(d.limit), "X-RateLimit-Remaining": "0" } },
  );
}

/** Path prefixes that require a signed-in user. Role checks happen server-side in pages/handlers. */
const PROTECTED_PREFIXES = ["/account", "/admin", "/merchant"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and gates protected
 * areas. This is a first line of defence only; each protected page/handler
 * re-verifies the user and role on the server (`requireUser` / `requireRole`)
 * and RLS enforces access in the database.
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname, search } = request.nextUrl;

  const limited = limitApi(request);
  if (limited) return limited;

  const redirectToSignIn = () => {
    const target = request.nextUrl.clone();
    target.pathname = "/sign-in";
    target.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(target);
  };

  // Fail closed: without configuration nobody is authenticated.
  if (!url || !anonKey) return isProtected(pathname) ? redirectToSignIn() : NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user && isProtected(pathname)) return redirectToSignIn();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
