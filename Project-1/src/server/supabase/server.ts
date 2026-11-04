import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "../config/env";

/**
 * Client for API callers that authenticate with `Authorization: Bearer <jwt>`
 * (the future Expo app and other NationX products). Still subject to RLS: the
 * token is forwarded to Postgres, which evaluates policies as that user.
 */
export function createBearerClient(accessToken: string): SupabaseClient {
  const env = getPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** Cookie session for browsers, bearer token for API clients. */
export async function createClientForRequest(request: Request): Promise<SupabaseClient> {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ? createBearerClient(match[1]) : createRequestClient();
}

/**
 * Request-scoped client acting as the signed-in user (or anon). Subject to RLS.
 * Default choice for reads/writes that run on behalf of a user.
 */
export async function createRequestClient(): Promise<SupabaseClient> {
  const env = getPublicEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware in Phase 2.
        }
      },
    },
  });
}
