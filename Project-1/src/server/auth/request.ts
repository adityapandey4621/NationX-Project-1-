import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "../config/env";
import { errorResponse } from "../http";
import { hasRole } from "../security/rbac";
import { getProfile, getUserRoles } from "../services/profile-service";
import { createClientForRequest } from "../supabase/server";
import type { UserRole } from "../validation";

export interface ApiCaller {
  db: SupabaseClient;
  userId: string;
  roles: UserRole[];
}

/**
 * Resolve the caller of a `/api/v1` request from the browser cookie session or
 * an `Authorization: Bearer` token. Always validates the token with Supabase
 * Auth, reads roles from `user_roles`, and treats deactivated accounts as
 * unauthenticated.
 */
export async function authenticateApiRequest(request: Request): Promise<ApiCaller | null> {
  if (!isSupabaseConfigured()) return null;
  const db = await createClientForRequest(request);
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;
  const [profile, roles] = await Promise.all([getProfile(db, data.user.id), getUserRoles(db, data.user.id)]);
  if (!profile || !profile.is_active) return null;
  return { db, userId: data.user.id, roles };
}

/** Outcome of an authorisation check: either the caller or a ready-made error response. */
export type Guard = { caller: ApiCaller } | { response: ReturnType<typeof errorResponse> };

export async function requireApiUser(request: Request): Promise<Guard> {
  const caller = await authenticateApiRequest(request);
  return caller ? { caller } : { response: errorResponse("UNAUTHENTICATED", "Authentication required") };
}

/** Admin-only endpoints. Non-admins get 403; the database re-checks the role regardless. */
export async function requireApiAdmin(request: Request): Promise<Guard> {
  const guard = await requireApiUser(request);
  if ("response" in guard) return guard;
  if (!hasRole(guard.caller.roles, "admin")) {
    return { response: errorResponse("FORBIDDEN", "Administrator access required") };
  }
  return guard;
}

/** Help-request handling: admins and operators. The database function re-checks the role. */
export async function requireApiStaff(request: Request): Promise<Guard> {
  const guard = await requireApiUser(request);
  if ("response" in guard) return guard;
  if (!(hasRole(guard.caller.roles, "admin") || hasRole(guard.caller.roles, "operator"))) {
    return { response: errorResponse("FORBIDDEN", "Operator or administrator access required") };
  }
  return guard;
}

/** Client for public (anonymous-capable) reads, or an error response when Supabase is not configured. */
export async function publicClient(
  request: Request,
): Promise<{ db: SupabaseClient } | { response: ReturnType<typeof errorResponse> }> {
  if (!isSupabaseConfigured()) {
    return { response: errorResponse("INTERNAL_ERROR", "Service is not configured", { status: 503 }) };
  }
  return { db: await createClientForRequest(request) };
}
