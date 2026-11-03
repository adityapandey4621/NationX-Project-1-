import "server-only";
import { isSupabaseConfigured } from "../config/env";
import { errorResponse } from "../http";
import { extractServiceKey, verifyServiceKey, type VerifiedClient } from "../services/integration-service";
import { createAdminClient } from "../supabase/admin";
import type { ServiceScope } from "../validation";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ServiceGuard =
  | { client: VerifiedClient; adminDb: SupabaseClient }
  | { response: ReturnType<typeof errorResponse> };

/**
 * Authenticates a machine caller (another NationX product) by `Authorization: Bearer nxsk_...`
 * and checks it holds `scope`. Human sessions are deliberately NOT accepted here: these
 * routes read platform-wide reference data. Failures never say whether a key exists.
 */
export async function requireServiceScope(request: Request, scope: ServiceScope): Promise<ServiceGuard> {
  if (!isSupabaseConfigured()) return { response: errorResponse("INTERNAL_ERROR", "Service is not configured", { status: 503 }) };
  const key = extractServiceKey(request.headers.get("authorization"));
  if (!key) return { response: unauthenticated() };
  const adminDb = createAdminClient();
  const client = await verifyServiceKey(adminDb, key);
  if (!client) return { response: unauthenticated() };
  if (!client.scopes.includes(scope)) return { response: errorResponse("FORBIDDEN", `This key does not have the "${scope}" scope`) };
  return { client, adminDb };
}

function unauthenticated() {
  const res = errorResponse("UNAUTHENTICATED", "A valid service key is required");
  res.headers.set("WWW-Authenticate", 'Bearer realm="nationx-integration"');
  return res;
}