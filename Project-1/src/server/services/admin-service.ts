import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fromPostgrest, ServiceError } from "./service-result";

/** Counts keyed by status/role, as returned by the admin_overview() database function. */
const counts = z.record(z.string(), z.coerce.number()).default({});
const num = z.coerce.number().default(0);

const areaRow = z.object({ id: z.string(), name: z.string(), is_active: z.boolean(), live: num, hidden: num, suspended: num, items: num, waiting: num });
const categoryRow = z.object({ id: z.string(), name: z.string(), is_active: z.boolean(), live: num, not_visible: num });

export const adminOverviewSchema = z.object({
  generated_at: z.string(),
  applications: counts,
  storefronts: z.object({ total: num, live: num, hidden: num, suspended: num, unpublished: num }),
  items: z.object({ total: num, published: num }),
  by_area: z.array(areaRow).default([]),
  by_category: z.array(categoryRow).default([]),
  help_requests: counts,
  waitlist_waiting: num,
  notifications: counts,
  people: counts,
});
export type AdminOverview = z.infer<typeof adminOverviewSchema>;

/** Everything the admin home page shows, in one database round trip. Administrator-only inside the database. */
export async function getAdminOverview(db: SupabaseClient): Promise<AdminOverview> {
  const { data, error } = await db.rpc("admin_overview");
  if (error) throw fromPostgrest(error, "getAdminOverview");
  return adminOverviewSchema.parse(data);
}

const teamRow = z.object({
  user_id: z.string(),
  full_name: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  is_active: z.boolean(),
  since: z.string(),
});
export type TeamMember = z.infer<typeof teamRow>;

export async function listTeam(db: SupabaseClient): Promise<TeamMember[]> {
  const { data, error } = await db.rpc("admin_list_team");
  if (error) throw fromPostgrest(error, "listTeam");
  return z.array(teamRow).parse(data);
}

export const roleChangeInput = z.object({
  email: z.string().trim().toLowerCase().max(254, "That e-mail address is too long").pipe(z.email("Enter the person's e-mail address")),
  role: z.enum(["admin", "operator"], { error: "Choose Administrator or Operator" }),
  grant: z.boolean(),
  reason: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
});
export type RoleChangeInput = z.infer<typeof roleChangeInput>;

/** Grant or revoke admin/operator. Audited, and protected against removing the last or your own admin in SQL. */
export async function changeUserRole(db: SupabaseClient, input: RoleChangeInput): Promise<"granted" | "revoked" | "unchanged"> {
  const v = roleChangeInput.parse(input);
  const { data, error } = await db.rpc("set_user_role", { p_email: v.email, p_role: v.role, p_grant: v.grant, p_reason: v.reason ?? null });
  if (error) {
    // These are written for the administrator to read; the generic mapper would replace them with "Not found".
    if (error.code === "P0002" || error.code === "23514") throw new ServiceError(error.code === "P0002" ? "NOT_FOUND" : "VALIDATION_ERROR", error.message, error);
    throw fromPostgrest(error, "changeUserRole");
  }
  return z.enum(["granted", "revoked", "unchanged"]).parse(data);
}
