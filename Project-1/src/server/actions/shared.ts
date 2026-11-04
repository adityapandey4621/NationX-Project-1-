import type { FormState } from "../auth/actions";
import { getManagedShop, MANAGER_ROLES } from "../services/storefront-service";
import { ServiceError } from "../services/service-result";
import { createRequestClient } from "../supabase/server";
import { ZodError } from "zod";

/** Resolve the shop for this user and require owner/manager rights (RLS enforces the same). */
export async function requireManagedShop(userId: string, shopId: string) {
  const db = await createRequestClient();
  const found = await getManagedShop(db, userId, shopId);
  if (!found) throw new ServiceError("NOT_FOUND", "Shop not found");
  if (!(MANAGER_ROLES as readonly string[]).includes(found.role)) {
    throw new ServiceError("FORBIDDEN", "Only owners and managers can edit this shop");
  }
  return { db, ...found };
}

export function field(formData: FormData, name: string): string {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Blank → null, for nullable columns the user may clear. */
export function nullableField(formData: FormData, name: string): string | null {
  const v = field(formData, name);
  return v === "" ? null : v;
}

/** User-safe error state; database/internal details are logged, never shown. */
export function actionError(e: unknown): FormState {
  if (e instanceof ServiceError && e.code !== "DATABASE_ERROR") return { error: e.message };
  if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Invalid input" };
  console.error("Server action failed", e);
  return { error: "Something went wrong. Please try again." };
}

/** Flatten a Zod error into field errors plus a top-level message for cross-field rules. */
export function zodState(error: ZodError): FormState {
  const flat = error.flatten();
  const form = flat.formErrors[0];
  return { fieldErrors: flat.fieldErrors, ...(form ? { error: form } : {}) };
}
