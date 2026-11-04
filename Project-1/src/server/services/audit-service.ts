import type { SupabaseClient } from "@supabase/supabase-js";
import { auditLogSchema, recordAuditInput, type AuditLog, type RecordAuditInput } from "../validation";
import { fromPostgrest } from "./service-result";

/**
 * Appends an immutable audit entry. Clients lack INSERT on audit_logs, so
 * `db` must be the service-role client. Multi-entity workflows (e.g. approval)
 * write their audit row inside the same database transaction instead; this
 * helper is for single-entity actions.
 */
export async function recordAuditEntry(db: SupabaseClient, input: RecordAuditInput): Promise<AuditLog> {
  const entry = recordAuditInput.parse(input);
  const { data, error } = await db.from("audit_logs").insert(entry).select().single();
  if (error) throw fromPostgrest(error, "recordAuditEntry");
  return auditLogSchema.parse(data);
}
