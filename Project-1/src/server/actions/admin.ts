"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "../auth/actions";
import { requireRole } from "../auth/session";
import { approveApplication, rejectApplication, requestApplicationCorrections, setStorefrontVisibility } from "../services";
import { createRequestClient } from "../supabase/server";
import { approveApplicationInput, uuidSchema, visibilityInput } from "../validation";
import { actionError, field, zodState } from "./shared";

/**
 * Admin decision on a submitted application. The role is verified here on the
 * server, and again inside the database functions (has_role('admin')).
 */
/** Hide, suspend or reactivate a live storefront (REQ-ADM-02). Admin-only here and in SQL; audited in SQL. */
export async function setVisibilityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole("admin", "/admin/storefronts");
  const id = uuidSchema.safeParse(field(formData, "storefront_id"));
  if (!id.success) return { error: "Unknown storefront" };
  const parsed = visibilityInput.safeParse({ status: field(formData, "status"), reason: field(formData, "reason") || undefined });
  if (!parsed.success) return zodState(parsed.error);
  try {
    const slug = field(formData, "slug");
    const res = await setStorefrontVisibility(await createRequestClient(), id.data, parsed.data);
    revalidatePath("/admin/storefronts");
    if (slug) revalidatePath(`/shop/${slug}`);
    revalidatePath("/search");
    revalidatePath("/");
    return { message: res.changed ? `Storefront is now ${parsed.data.status}.` : `Already ${parsed.data.status}.` };
  } catch (e) {
    return actionError(e);
  }
}

export async function decideApplicationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuidSchema.safeParse(field(formData, "application_id"));
  if (!id.success) return { error: "Unknown application" };
  await requireRole("admin", `/admin/applications/${id.data}`);
  const decision = field(formData, "decision");
  const db = await createRequestClient();

  try {
    if (decision === "approve") {
      const input = approveApplicationInput.safeParse({
        review_notes: field(formData, "review_notes") || undefined,
        custom_slug: field(formData, "custom_slug") || undefined,
      });
      if (!input.success) return zodState(input.error);
      const result = await approveApplication(db, id.data, input.data);
      revalidatePath("/admin/applications");
      revalidatePath(`/admin/applications/${id.data}`);
      return {
        message: result.already_approved
          ? `Already approved. Storefront: /shop/${result.slug}`
          : `Approved. Storefront published at /shop/${result.slug}`,
      };
    }
    if (decision === "reject") {
      await rejectApplication(db, id.data, field(formData, "reason"));
    } else if (decision === "request_corrections") {
      await requestApplicationCorrections(db, id.data, field(formData, "notes"));
    } else {
      return { error: "Unknown decision" };
    }
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/admin/applications");
  revalidatePath(`/admin/applications/${id.data}`);
  return { message: decision === "reject" ? "Application rejected." : "Corrections requested from the applicant." };
}
