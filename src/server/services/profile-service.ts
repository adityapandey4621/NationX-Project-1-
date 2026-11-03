import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  profileSchema,
  updateProfileInput,
  userRoleSchema,
  uuidSchema,
  type Profile,
  type UpdateProfileInput,
  type UserRole,
} from "../validation";
import { fromPostgrest, ServiceError } from "./service-result";

/** Reads a profile. Under RLS a user can only read their own (admins: any). */
export async function getProfile(db: SupabaseClient, userId: string): Promise<Profile | null> {
  const id = uuidSchema.parse(userId);
  const { data, error } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw fromPostgrest(error, "getProfile");
  return data ? profileSchema.parse(data) : null;
}

/** Roles held by a user, from the authoritative `user_roles` table. */
export async function getUserRoles(db: SupabaseClient, userId: string): Promise<UserRole[]> {
  const id = uuidSchema.parse(userId);
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", id);
  if (error) throw fromPostgrest(error, "getUserRoles");
  return z.array(z.object({ role: userRoleSchema })).parse(data).map((r) => r.role);
}

/**
 * Updates the caller's own profile. The write is scoped to `userId` and also
 * constrained by RLS + the guard trigger, so privileged columns cannot change.
 */
export async function updateOwnProfile(
  db: SupabaseClient,
  userId: string,
  input: UpdateProfileInput,
): Promise<Profile> {
  const id = uuidSchema.parse(userId);
  const patch = updateProfileInput.parse(input);
  const { data, error } = await db.from("profiles").update(patch).eq("id", id).select().maybeSingle();
  if (error) throw fromPostgrest(error, "updateOwnProfile");
  if (!data) throw new ServiceError("NOT_FOUND", "Profile not found");
  return profileSchema.parse(data);
}
