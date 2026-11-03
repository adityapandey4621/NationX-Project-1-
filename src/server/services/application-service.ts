import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  approveApplicationInput,
  auditLogSchema,
  merchantApplicationSchema,
  profileSchema,
  rejectApplicationInput,
  requestCorrectionsInput,
  saveApplicationDraftInput,
  uuidSchema,
  EDITABLE_APPLICATION_STATUSES,
  type ApplicationStatus,
  type ApproveApplicationInput,
  type MerchantApplication,
  type SaveApplicationDraftInput,
} from "../validation";
import { fromPostgrest, ServiceError } from "./service-result";

const APPLICATION_JOINS = "*, category:categories(name, slug), locality:localities(name, slug, pincode)";

const withNames = merchantApplicationSchema.extend({
  category: z.object({ name: z.string(), slug: z.string() }).nullable(),
  locality: z.object({ name: z.string(), slug: z.string(), pincode: z.string() }).nullable(),
});
export type ApplicationWithNames = z.infer<typeof withNames>;

/** Convert validated form input to DB columns (undefined → omitted, so partial saves keep other columns). */
function toColumns(input: SaveApplicationDraftInput): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

/**
 * Stored files must live in the caller's own private folder. This stops an
 * applicant from referencing someone else's uploads (or arbitrary paths).
 */
export function assertOwnStoragePaths(userId: string, input: SaveApplicationDraftInput): void {
  const paths = [
    ...(input.logo_storage_path ? [input.logo_storage_path] : []),
    ...(input.photos_storage_paths ?? []),
    ...(input.document_storage_paths ?? []),
  ];
  for (const p of paths) {
    if (!p.startsWith(`${userId}/`) || p.includes("..")) {
      throw new ServiceError("VALIDATION_ERROR", "Invalid file reference");
    }
  }
}

function duplicateMessage(e: ServiceError): ServiceError {
  return e.code === "CONFLICT"
    ? new ServiceError(
        "CONFLICT",
        "You already have an open application for this business in this locality. Open it from your dashboard instead.",
        e,
      )
    : e;
}

/** Applicant: create a draft. Duplicates (same applicant + name + locality) are refused by the database. */
export async function createApplicationDraft(
  db: SupabaseClient,
  userId: string,
  input: SaveApplicationDraftInput,
): Promise<MerchantApplication> {
  const uid = uuidSchema.parse(userId);
  const data = saveApplicationDraftInput.parse(input);
  assertOwnStoragePaths(uid, data);
  const { data: row, error } = await db
    .from("merchant_applications")
    .insert({ ...toColumns(data), applicant_user_id: uid, status: "draft" })
    .select()
    .single();
  if (error) throw duplicateMessage(fromPostgrest(error, "createApplicationDraft"));
  return merchantApplicationSchema.parse(row);
}

/** Applicant: edit a draft / correction-requested application. RLS limits this to editable statuses. */
export async function updateApplicationDraft(
  db: SupabaseClient,
  userId: string,
  applicationId: string,
  input: SaveApplicationDraftInput,
): Promise<MerchantApplication> {
  const uid = uuidSchema.parse(userId);
  const id = uuidSchema.parse(applicationId);
  const data = saveApplicationDraftInput.parse(input);
  assertOwnStoragePaths(uid, data);
  const { data: row, error } = await db
    .from("merchant_applications")
    .update(toColumns(data))
    .eq("id", id)
    .eq("applicant_user_id", uid)
    .select()
    .maybeSingle();
  if (error) throw duplicateMessage(fromPostgrest(error, "updateApplicationDraft"));
  if (!row) throw new ServiceError("CONFLICT", "This application can no longer be edited");
  return merchantApplicationSchema.parse(row);
}

/**
 * Applicant: submit for review. The database re-checks ownership, status and
 * the declaration, flips the status and audits the change in one transaction.
 */
export async function submitApplication(db: SupabaseClient, applicationId: string): Promise<void> {
  const id = uuidSchema.parse(applicationId);
  const { error } = await db.rpc("submit_merchant_application", { p_application_id: id });
  if (error) throw fromPostgrest(error, "submitApplication");
}

export type ApplicationFileKind = "logo" | "photo" | "document";
const MAX_PHOTOS = 8;
const MAX_DOCUMENTS = 10;

/** Record an uploaded file on an editable application (replaces the logo; appends photos/documents). */
export async function attachApplicationFile(
  db: SupabaseClient,
  userId: string,
  applicationId: string,
  kind: ApplicationFileKind,
  path: string,
): Promise<void> {
  const uid = uuidSchema.parse(userId);
  const app = await getMyApplication(db, uid, applicationId);
  if (!app || !isEditableStatus(app.status)) {
    throw new ServiceError("CONFLICT", "This application can no longer be edited");
  }
  if (!path.startsWith(`${uid}/${app.id}/`)) throw new ServiceError("VALIDATION_ERROR", "Invalid file reference");

  let patch: Record<string, unknown>;
  if (kind === "logo") {
    patch = { logo_storage_path: path };
  } else if (kind === "photo") {
    const photos = [...(app.photos_storage_paths ?? []), path];
    if (photos.length > MAX_PHOTOS) throw new ServiceError("VALIDATION_ERROR", `You can add up to ${MAX_PHOTOS} photos`);
    patch = { photos_storage_paths: photos };
  } else {
    const docs = [...(app.document_storage_paths ?? []), path];
    if (docs.length > MAX_DOCUMENTS) throw new ServiceError("VALIDATION_ERROR", `You can add up to ${MAX_DOCUMENTS} documents`);
    patch = { document_storage_paths: docs };
  }
  const { error } = await db.from("merchant_applications").update(patch).eq("id", app.id).eq("applicant_user_id", uid);
  if (error) throw fromPostgrest(error, "attachApplicationFile");
}

/** Drop a file reference from an editable application; returns whether it was present. */
export async function detachApplicationFile(
  db: SupabaseClient,
  userId: string,
  applicationId: string,
  path: string,
): Promise<boolean> {
  const uid = uuidSchema.parse(userId);
  const app = await getMyApplication(db, uid, applicationId);
  if (!app || !isEditableStatus(app.status)) {
    throw new ServiceError("CONFLICT", "This application can no longer be edited");
  }
  const patch = {
    logo_storage_path: app.logo_storage_path === path ? null : app.logo_storage_path,
    photos_storage_paths: (app.photos_storage_paths ?? []).filter((p) => p !== path),
    document_storage_paths: (app.document_storage_paths ?? []).filter((p) => p !== path),
  };
  const present = app.logo_storage_path === path || [...(app.photos_storage_paths ?? []), ...(app.document_storage_paths ?? [])].includes(path);
  if (!present) return false;
  const { error } = await db.from("merchant_applications").update(patch).eq("id", app.id).eq("applicant_user_id", uid);
  if (error) throw fromPostgrest(error, "detachApplicationFile");
  return true;
}

export async function deleteApplicationDraft(db: SupabaseClient, userId: string, applicationId: string): Promise<void> {
  const { error } = await db
    .from("merchant_applications")
    .delete()
    .eq("id", uuidSchema.parse(applicationId))
    .eq("applicant_user_id", uuidSchema.parse(userId))
    .eq("status", "draft");
  if (error) throw fromPostgrest(error, "deleteApplicationDraft");
}

export async function listMyApplications(db: SupabaseClient, userId: string): Promise<ApplicationWithNames[]> {
  const { data, error } = await db
    .from("merchant_applications")
    .select(APPLICATION_JOINS)
    .eq("applicant_user_id", uuidSchema.parse(userId))
    .order("created_at", { ascending: false });
  if (error) throw fromPostgrest(error, "listMyApplications");
  return z.array(withNames).parse(data);
}

export async function getMyApplication(
  db: SupabaseClient,
  userId: string,
  applicationId: string,
): Promise<ApplicationWithNames | null> {
  const { data, error } = await db
    .from("merchant_applications")
    .select(APPLICATION_JOINS)
    .eq("id", uuidSchema.parse(applicationId))
    .eq("applicant_user_id", uuidSchema.parse(userId))
    .maybeSingle();
  if (error) throw fromPostgrest(error, "getMyApplication");
  return data ? withNames.parse(data) : null;
}

export function isEditableStatus(status: ApplicationStatus): boolean {
  return (EDITABLE_APPLICATION_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Administrator operations. Every function below is also enforced in the
// database (has_role('admin') inside the SECURITY DEFINER functions + RLS).
// ---------------------------------------------------------------------------

const adminRow = withNames.extend({
  applicant: profileSchema.pick({ full_name: true, phone: true, email: true }).nullable(),
});
export type AdminApplicationRow = z.infer<typeof adminRow>;

const ADMIN_SELECT = `${APPLICATION_JOINS}, applicant:profiles!applicant_user_id(full_name, phone, email)`;

export async function listApplicationsForAdmin(
  db: SupabaseClient,
  opts: { status?: ApplicationStatus; limit?: number; offset?: number } = {},
): Promise<AdminApplicationRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  // Drafts are private to their author; the queue starts at submission.
  let query = db.from("merchant_applications").select(ADMIN_SELECT).neq("status", "draft");
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query.order("created_at", { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw fromPostgrest(error, "listApplicationsForAdmin");
  return z.array(adminRow).parse(data);
}

export async function countApplicationsByStatus(db: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await db.from("merchant_applications").select("status").neq("status", "draft");
  if (error) throw fromPostgrest(error, "countApplicationsByStatus");
  const counts: Record<string, number> = {};
  for (const row of z.array(z.object({ status: z.string() })).parse(data)) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

const duplicateSchema = z.object({
  kind: z.enum(["application", "shop"]),
  id: uuidSchema,
  label: z.string(),
  detail: z.string(),
  reason: z.enum(["same_phone", "same_address"]),
});
export type DuplicateWarning = z.infer<typeof duplicateSchema>;

export interface AdminApplicationDetail {
  application: AdminApplicationRow;
  history: z.infer<typeof auditLogSchema>[];
  duplicates: DuplicateWarning[];
}

export async function getApplicationForAdmin(
  db: SupabaseClient,
  applicationId: string,
): Promise<AdminApplicationDetail | null> {
  const id = uuidSchema.parse(applicationId);
  const { data, error } = await db.from("merchant_applications").select(ADMIN_SELECT).eq("id", id).maybeSingle();
  if (error) throw fromPostgrest(error, "getApplicationForAdmin");
  if (!data) return null;
  const application = adminRow.parse(data);
  if (application.status === "draft") return null; // drafts are not part of the review queue

  const [history, duplicates] = await Promise.all([
    db
      .from("audit_logs")
      .select("*")
      .eq("entity_type", "merchant_application")
      .eq("entity_id", id)
      .order("created_at", { ascending: true }),
    db.rpc("find_application_duplicates", { p_application_id: id }),
  ]);
  if (history.error) throw fromPostgrest(history.error, "getApplicationForAdmin.history");
  if (duplicates.error) throw fromPostgrest(duplicates.error, "getApplicationForAdmin.duplicates");
  return {
    application,
    history: z.array(auditLogSchema).parse(history.data),
    duplicates: z.array(duplicateSchema).parse(duplicates.data),
  };
}

const approvalResultSchema = z.object({
  application_id: uuidSchema,
  business_id: uuidSchema,
  shop_id: uuidSchema,
  storefront_id: uuidSchema,
  slug: z.string(),
  owner_id: uuidSchema,
  already_approved: z.boolean(),
});
export type ApprovalResult = z.infer<typeof approvalResultSchema>;

/** Atomic and idempotent: creates business, owner, shop and a published storefront with a unique slug. */
export async function approveApplication(
  db: SupabaseClient,
  applicationId: string,
  input: ApproveApplicationInput = {},
): Promise<ApprovalResult> {
  const id = uuidSchema.parse(applicationId);
  const opts = approveApplicationInput.parse(input);
  const { data, error } = await db.rpc("approve_merchant_application", {
    p_application_id: id,
    p_review_notes: opts.review_notes ?? null,
    p_category_id: opts.assigned_category_id ?? null,
    p_custom_slug: opts.custom_slug ?? null,
  });
  if (error) throw fromPostgrest(error, "approveApplication");
  return approvalResultSchema.parse(data);
}

export async function rejectApplication(db: SupabaseClient, applicationId: string, reason: string): Promise<void> {
  const { reason: text } = rejectApplicationInput.parse({ reason });
  const { error } = await db.rpc("review_merchant_application", {
    p_application_id: uuidSchema.parse(applicationId),
    p_decision: "reject",
    p_text: text,
  });
  if (error) throw fromPostgrest(error, "rejectApplication");
}

export async function requestApplicationCorrections(
  db: SupabaseClient,
  applicationId: string,
  notes: string,
): Promise<void> {
  const { notes: text } = requestCorrectionsInput.parse({ notes });
  const { error } = await db.rpc("review_merchant_application", {
    p_application_id: uuidSchema.parse(applicationId),
    p_decision: "request_corrections",
    p_text: text,
  });
  if (error) throw fromPostgrest(error, "requestApplicationCorrections");
}
