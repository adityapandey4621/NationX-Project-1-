import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "../config/env";

/**
 * Service-role client: bypasses RLS. Use only inside trusted server code that
 * has already authenticated and authorised the caller (e.g. the atomic
 * approval pipeline, audit writes). Never import into client components.
 */
export function createAdminClient(): SupabaseClient {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
