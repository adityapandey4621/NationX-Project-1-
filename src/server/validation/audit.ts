import { z } from "zod";
import { nonEmptyText, timestampSchema, uuidSchema } from "./common";

/** Row shape for public.audit_logs (immutable). */
export const auditLogSchema = z.object({
  id: uuidSchema,
  actor_id: uuidSchema.nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: uuidSchema,
  previous_state: z.record(z.string(), z.unknown()).nullable(),
  new_state: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  created_at: timestampSchema,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** Input accepted when recording an audit entry. */
export const recordAuditInput = z.object({
  actor_id: uuidSchema.nullable(),
  action: nonEmptyText(100),
  entity_type: nonEmptyText(100),
  entity_id: uuidSchema,
  previous_state: z.record(z.string(), z.unknown()).nullish(),
  new_state: z.record(z.string(), z.unknown()).nullish(),
  reason: z.string().trim().max(1000).nullish(),
  ip_address: z.string().max(64).nullish(),
  user_agent: z.string().max(512).nullish(),
});
export type RecordAuditInput = z.infer<typeof recordAuditInput>;
