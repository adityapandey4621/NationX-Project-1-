import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  joinWaitlistInput,
  leaveWaitlistInput,
  setWaitlistStatusInput,
  waitlistDemandSchema,
  waitlistEntrySchema,
  type WaitlistDemand,
  type WaitlistEntry,
} from "../validation";
import { fromPostgrest } from "./service-result";

export type JoinResult = "joined" | "already_waiting";

/** Join an area list. Validation, consent, per-number limits and de-duplication are enforced in the database too. */
export async function joinWaitlist(db: SupabaseClient, raw: unknown): Promise<JoinResult> {
  const input = joinWaitlistInput.parse(raw);
  const { data, error } = await db.rpc("join_area_waitlist", {
    p_locality_id: input.locality_id,
    p_category_id: input.category_id ?? null,
    p_phone: input.contact_phone,
    p_name: input.contact_name ?? null,
    p_consent: input.consent_given,
  });
  if (error) throw fromPostgrest(error, "joinWaitlist");
  return z.enum(["joined", "already_waiting"]).parse(data);
}

/** Withdraw consent: deletes the entry (phone number included). Returns whether anything was removed. */
export async function leaveWaitlist(db: SupabaseClient, raw: unknown): Promise<boolean> {
  const input = leaveWaitlistInput.parse(raw);
  const { data, error } = await db.rpc("leave_area_waitlist", { p_locality_id: input.locality_id, p_phone: input.contact_phone });
  if (error) throw fromPostgrest(error, "leaveWaitlist");
  return data === true;
}

/** Aggregate counts per area. Never contains a name or phone number. */
export async function listWaitlistDemand(db: SupabaseClient): Promise<WaitlistDemand[]> {
  const { data, error } = await db.rpc("waitlist_demand");
  if (error) throw fromPostgrest(error, "listWaitlistDemand");
  return z.array(waitlistDemandSchema).parse(data);
}

/** Staff only (row-level security returns nothing to anyone else). */
export async function listWaitlistForStaff(db: SupabaseClient, opts: { status?: "waiting" | "contacted" | undefined } = {}): Promise<WaitlistEntry[]> {
  let q = db
    .from("area_waitlist")
    .select("id, locality_id, category_id, contact_phone, contact_name, status, consented_at, contacted_at, created_at, locality:localities(name), category:categories(name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw fromPostgrest(error, "listWaitlistForStaff");
  return z.array(waitlistEntrySchema).parse(data);
}

export async function setWaitlistStatus(db: SupabaseClient, id: string, raw: unknown): Promise<boolean> {
  const { status } = setWaitlistStatusInput.parse(raw);
  const { data, error } = await db.rpc("set_waitlist_status", { p_id: z.uuid().parse(id), p_status: status });
  if (error) throw fromPostgrest(error, "setWaitlistStatus");
  return data === true;
}

/** Areas where enough people are waiting to be worth showing publicly (small numbers are noise and easy to game). */
export const DEMAND_DISPLAY_MIN = 3;
export function visibleDemand(rows: readonly WaitlistDemand[]): WaitlistDemand[] {
  return rows.filter((r) => r.waiting >= DEMAND_DISPLAY_MIN).sort((a, b) => b.waiting - a.waiting);
}