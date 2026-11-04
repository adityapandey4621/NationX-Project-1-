"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "../auth/actions";
import { requireRole, requireUser } from "../auth/session";
import { isSupabaseConfigured } from "../config/env";
import { normalizeIndianPhone } from "@/lib/phone";
import {
  assignHelpRequest,
  cancelMyHelpRequest,
  ServiceError,
  trackHelpRequest,
  submitHelpRequest,
  updateHelpRequest,
} from "../services";
import { createRequestClient } from "../supabase/server";
import {
  submitHelpRequestInput,
  trackHelpRequestInput,
  updateHelpRequestInput,
  uuidSchema,
  type TrackedHelpRequest,
} from "../validation";
import { actionError, field, zodState } from "./shared";

export type HelpRequestState = FormState & { trackingId?: string; tracked?: TrackedHelpRequest };

const UNAVAILABLE: HelpRequestState = { error: "This service is temporarily unavailable. Please try again later." };

/** Customer or visitor submits a request. Validation, numbering and throttling happen in the database too. */
export async function submitHelpRequestAction(_prev: HelpRequestState, formData: FormData): Promise<HelpRequestState> {
  // Honeypot: real users never see or fill this field; bots usually do.
  if (field(formData, "website") !== "") return { error: "We couldn't submit your request. Please try again." };
  if (!isSupabaseConfigured()) return UNAVAILABLE;

  const parsed = submitHelpRequestInput.safeParse({
    item_name: field(formData, "item_name"),
    item_description: field(formData, "item_description") || undefined,
    preferred_locality_id: field(formData, "locality_id"),
    category_id: field(formData, "category_id") || undefined,
    contact_name: field(formData, "contact_name"),
    contact_phone: normalizeIndianPhone(field(formData, "contact_phone")),
    contact_email: field(formData, "contact_email") || undefined,
    consent_given: formData.get("consent_given") === "on",
  });
  if (!parsed.success) return zodState(parsed.error);

  try {
    const result = await submitHelpRequest(await createRequestClient(), parsed.data);
    revalidatePath("/account/requests");
    return { trackingId: result.tracking_id, message: "Your request has been received." };
  } catch (e) {
    return actionError(e);
  }
}

/** Anonymous status check: tracking id + phone. */
export async function trackHelpRequestAction(_prev: HelpRequestState, formData: FormData): Promise<HelpRequestState> {
  if (!isSupabaseConfigured()) return UNAVAILABLE;
  const parsed = trackHelpRequestInput.safeParse({
    tracking_id: field(formData, "tracking_id"),
    contact_phone: normalizeIndianPhone(field(formData, "contact_phone")),
  });
  if (!parsed.success) return zodState(parsed.error);
  try {
    return { tracked: await trackHelpRequest(await createRequestClient(), parsed.data) };
  } catch (e) {
    // Same message whether the id or the phone was wrong.
    if (e instanceof ServiceError && e.code === "NOT_FOUND") {
      return { error: "We couldn't find a request with that tracking ID and phone number." };
    }
    return actionError(e);
  }
}

export async function cancelHelpRequestAction(formData: FormData): Promise<void> {
  await requireUser("/account/requests");
  await cancelMyHelpRequest(await createRequestClient(), uuidSchema.parse(field(formData, "request_id")));
  revalidatePath("/account/requests");
}

/** Operator / admin handling. Role is checked here and inside the database function. */
/** Administrators give a request to a named operator, or take it back (empty choice). */
export async function assignHelpRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuidSchema.safeParse(field(formData, "request_id"));
  if (!id.success) return { error: "Unknown request" };
  await requireRole("admin", `/admin/help-requests/${id.data}`);
  const chosen = field(formData, "operator_id");
  const operator = chosen === "" ? null : uuidSchema.safeParse(chosen);
  if (operator !== null && !operator.success) return { error: "Choose a person from the list" };
  try {
    const result = await assignHelpRequest(await createRequestClient(), id.data, operator === null ? null : operator.data);
    revalidatePath("/admin/help-requests");
    revalidatePath(`/admin/help-requests/${id.data}`);
    return { message: result === "assigned" ? "Request assigned." : result === "unassigned" ? "Request is now unassigned." : "No change: that is already the assignment." };
  } catch (e) {
    return actionError(e);
  }
}

export async function updateHelpRequestAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = uuidSchema.safeParse(field(formData, "request_id"));
  if (!id.success) return { error: "Unknown request" };
  await requireRole(["admin", "operator"], `/admin/help-requests/${id.data}`);
  const parsed = updateHelpRequestInput.safeParse({
    status: field(formData, "status"),
    notes: field(formData, "notes") || undefined,
    matched_shop_slug: field(formData, "matched_shop_slug") || undefined,
  });
  if (!parsed.success) return zodState(parsed.error);
  try {
    await updateHelpRequest(await createRequestClient(), id.data, parsed.data);
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/admin/help-requests");
  revalidatePath(`/admin/help-requests/${id.data}`);
  return { message: "Request updated." };
}
