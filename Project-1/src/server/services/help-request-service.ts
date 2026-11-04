import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  helpRequestWithJoinsSchema,
  submitHelpRequestInput,
  submitHelpRequestResultSchema,
  trackedHelpRequestSchema,
  trackHelpRequestInput,
  updateHelpRequestInput,
  uuidSchema,
  type HelpRequest,
  type SubmitHelpRequestInput,
  type TrackedHelpRequest,
  type UpdateHelpRequestInput,
} from "../validation";
import { fromPostgrest } from "./service-result";

const SELECT =
  "*, locality:localities!preferred_locality_id(name), category:categories(name), matched_shop:shops!matched_shop_id(name, storefront:storefronts(slug))";

/**
 * Create a request. Works for anonymous visitors and signed-in customers (the
 * database attaches auth.uid() when present). The database validates, throttles,
 * numbers the request and stores it; there is no direct table insert.
 */
export async function submitHelpRequest(db: SupabaseClient, raw: SubmitHelpRequestInput) {
  const input = submitHelpRequestInput.parse(raw);
  const { data, error } = await db.rpc("submit_help_request", {
    p_item_name: input.item_name,
    p_item_description: input.item_description ?? null,
    p_locality_id: input.preferred_locality_id,
    p_category_id: input.category_id ?? null,
    p_contact_name: input.contact_name,
    p_contact_phone: input.contact_phone,
    p_contact_email: input.contact_email ?? null,
    p_consent: input.consent_given,
  });
  if (error) throw fromPostgrest(error, "submitHelpRequest");
  return submitHelpRequestResultSchema.parse(data);
}

/** A signed-in customer's own requests (row-level security limits this to the caller). */
export async function listMyHelpRequests(db: SupabaseClient, userId: string): Promise<HelpRequest[]> {
  const { data, error } = await db
    .from("help_me_find_it_requests")
    .select(SELECT)
    .eq("customer_user_id", uuidSchema.parse(userId))
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw fromPostgrest(error, "listMyHelpRequests");
  return z.array(helpRequestWithJoinsSchema).parse(data);
}

export async function cancelMyHelpRequest(db: SupabaseClient, requestId: string): Promise<void> {
  const { error } = await db.rpc("cancel_help_request", { p_request_id: uuidSchema.parse(requestId) });
  if (error) throw fromPostgrest(error, "cancelMyHelpRequest");
}

/** Status lookup without an account: needs the tracking id AND the phone number it was submitted with. */
export async function trackHelpRequest(
  db: SupabaseClient,
  raw: { tracking_id: string; contact_phone: string },
): Promise<TrackedHelpRequest> {
  const input = trackHelpRequestInput.parse(raw);
  const { data, error } = await db.rpc("track_help_request", {
    p_tracking_id: input.tracking_id,
    p_phone: input.contact_phone,
  });
  if (error) throw fromPostgrest(error, "trackHelpRequest");
  return trackedHelpRequestSchema.parse(data);
}

// --- Staff (admin / operator) ---------------------------------------------------------------

export async function listHelpRequestsForStaff(
  db: SupabaseClient,
  opts: { status?: HelpRequest["status"]; limit?: number; offset?: number } = {},
): Promise<HelpRequest[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  let query = db.from("help_me_find_it_requests").select(SELECT);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query.order("created_at", { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw fromPostgrest(error, "listHelpRequestsForStaff");
  return z.array(helpRequestWithJoinsSchema).parse(data);
}

export async function getHelpRequestForStaff(db: SupabaseClient, requestId: string): Promise<HelpRequest | null> {
  const { data, error } = await db
    .from("help_me_find_it_requests")
    .select(SELECT)
    .eq("id", uuidSchema.parse(requestId))
    .maybeSingle();
  if (error) throw fromPostgrest(error, "getHelpRequestForStaff");
  return data ? helpRequestWithJoinsSchema.parse(data) : null;
}

/** Staff decision; the database checks role, allowed transition, and requires a real shop for "matched". */
const assignableOperatorSchema = z.object({ user_id: uuidSchema, full_name: z.string(), roles: z.array(z.string()) });
export type AssignableOperator = z.infer<typeof assignableOperatorSchema>;

/** Active administrators and operators who can be given a request (staff only; the database enforces it). */
export async function listAssignableOperators(db: SupabaseClient): Promise<AssignableOperator[]> {
  const { data, error } = await db.rpc("list_assignable_operators");
  if (error) throw fromPostgrest(error, "listAssignableOperators");
  return z.array(assignableOperatorSchema).parse(data);
}

/** Assign (or, with null, unassign) a request. Administrators only. Does not change the status or message the customer. */
export async function assignHelpRequest(db: SupabaseClient, requestId: string, operatorId: string | null): Promise<"assigned" | "unassigned" | "unchanged"> {
  const { data, error } = await db.rpc("assign_help_request", {
    p_request_id: uuidSchema.parse(requestId),
    p_operator_id: operatorId === null ? null : uuidSchema.parse(operatorId),
  });
  if (error) throw fromPostgrest(error, "assignHelpRequest");
  return z.enum(["assigned", "unassigned", "unchanged"]).parse(data);
}

export async function updateHelpRequest(db: SupabaseClient, requestId: string, raw: UpdateHelpRequestInput): Promise<void> {
  const input = updateHelpRequestInput.parse(raw);
  const { error } = await db.rpc("update_help_request", {
    p_request_id: uuidSchema.parse(requestId),
    p_status: input.status,
    p_notes: input.notes ?? null,
    p_matched_shop_slug: input.matched_shop_slug ?? null,
  });
  if (error) throw fromPostgrest(error, "updateHelpRequest");
}
