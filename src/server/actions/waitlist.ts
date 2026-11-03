"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "../auth/actions";
import { requireRole } from "../auth/session";
import { isSupabaseConfigured } from "../config/env";
import { normalizeIndianPhone } from "@/lib/phone";
import { joinWaitlist, leaveWaitlist, setWaitlistStatus } from "../services";
import { createRequestClient } from "../supabase/server";
import { joinWaitlistInput, leaveWaitlistInput, uuidSchema } from "../validation";
import { actionError, field, zodState } from "./shared";

/** `values` echoes what the person typed after a failed attempt, so the form does not wipe their input. */
export type WaitlistState = FormState & { joined?: "joined" | "already_waiting"; left?: boolean; values?: { locality_id: string; category_id: string; contact_name: string; contact_phone: string } };

const UNAVAILABLE: WaitlistState = { error: "This service is temporarily unavailable. Please try again later." };

export async function joinWaitlistAction(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  // Honeypot: real people never see this field.
  if (field(formData, "website") !== "") return { error: "We couldn't save that. Please try again." };
  if (!isSupabaseConfigured()) return UNAVAILABLE;
  const values = {
    locality_id: field(formData, "locality_id"),
    category_id: field(formData, "category_id"),
    contact_name: field(formData, "contact_name"),
    contact_phone: field(formData, "contact_phone"),
  };
  const parsed = joinWaitlistInput.safeParse({
    locality_id: field(formData, "locality_id"),
    category_id: field(formData, "category_id") || undefined,
    contact_phone: normalizeIndianPhone(field(formData, "contact_phone")),
    contact_name: field(formData, "contact_name") || undefined,
    consent_given: formData.get("consent_given") === "on",
  });
  if (!parsed.success) return { ...zodState(parsed.error), values };
  try {
    return { joined: await joinWaitlist(await createRequestClient(), parsed.data) };
  } catch (e) {
    return { ...actionError(e), values };
  }
}

export async function leaveWaitlistAction(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  if (!isSupabaseConfigured()) return UNAVAILABLE;
  const parsed = leaveWaitlistInput.safeParse({
    locality_id: field(formData, "locality_id"),
    contact_phone: normalizeIndianPhone(field(formData, "contact_phone")),
  });
  if (!parsed.success) return zodState(parsed.error);
  try {
    // Same answer whether or not an entry existed, so the form cannot be used to test whether a number is listed.
    await leaveWaitlist(await createRequestClient(), parsed.data);
    return { left: true };
  } catch (e) {
    return actionError(e);
  }
}

/** Staff: mark a person contacted or put them back. */
export async function setWaitlistStatusAction(formData: FormData): Promise<void> {
  await requireRole(["admin", "operator"], "/admin/waitlist");
  const id = uuidSchema.safeParse(field(formData, "id"));
  const status = field(formData, "status");
  if (!id.success) return;
  await setWaitlistStatus(await createRequestClient(), id.data, { status });
  revalidatePath("/admin/waitlist");
}