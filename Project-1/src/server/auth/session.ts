import "server-only";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "../config/env";
import { hasAnyRole } from "../security/rbac";
import { getProfile, getUserRoles } from "../services/profile-service";
import { createRequestClient } from "../supabase/server";
import type { Profile, UserRole } from "../validation";

export interface AuthContext {
  user: User;
  profile: Profile | null;
  roles: UserRole[];
}

/**
 * Resolves the signed-in user for this request, or null.
 *
 * `auth.getUser()` re-validates the token with Supabase Auth on every call;
 * `getSession()` (cookie only) is deliberately NOT used for authorisation.
 * Roles come from the `user_roles` table through RLS, never from JWT claims
 * or user metadata. Memoised per request.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  // Reading cookies opts every page that shows auth state into dynamic
  // rendering, so a signed-in header is never statically cached or shared.
  await cookies();
  // Fail closed: without configuration nobody is authenticated.
  if (!isSupabaseConfigured()) return null;

  const db = await createRequestClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return null;

  const [profile, roles] = await Promise.all([
    getProfile(db, data.user.id),
    getUserRoles(db, data.user.id),
  ]);
  // A deactivated account is treated as signed out for all authorisation.
  if (profile && !profile.is_active) return null;
  return { user: data.user, profile, roles };
});

/** Page/action guard: redirects anonymous users to sign-in, preserving the target. */
export async function requireUser(returnTo = "/account"): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return ctx;
}

/**
 * Page/action guard for role-restricted areas. Users lacking the role get a
 * 404 so restricted routes do not confirm their own existence.
 */
export async function requireRole(allowed: UserRole | readonly UserRole[], returnTo: string): Promise<AuthContext> {
  const ctx = await requireUser(returnTo);
  const list = typeof allowed === "string" ? [allowed] : allowed;
  if (!hasAnyRole(ctx.roles, list)) notFound();
  return ctx;
}
