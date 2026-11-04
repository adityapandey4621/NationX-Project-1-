import { z } from "zod";
import { nonEmptyText, phoneSchema, timestampSchema, uuidSchema } from "./common";

export const joinWaitlistInput = z.object({
  locality_id: uuidSchema,
  category_id: uuidSchema.optional(),
  contact_phone: phoneSchema,
  contact_name: nonEmptyText(120).optional(),
  consent_given: z.literal(true, "Please agree to be contacted when shops open in this area"),
});
export type JoinWaitlistInput = z.infer<typeof joinWaitlistInput>;

export const leaveWaitlistInput = z.object({ locality_id: uuidSchema, contact_phone: phoneSchema });

export const waitlistDemandSchema = z.object({
  locality_slug: z.string(),
  locality_name: z.string(),
  waiting: z.coerce.number().int().nonnegative(),
});
export type WaitlistDemand = z.infer<typeof waitlistDemandSchema>;

export const WAITLIST_STATUSES = ["waiting", "contacted"] as const;
export const setWaitlistStatusInput = z.object({ status: z.enum(WAITLIST_STATUSES) });

/** A row as staff see it. */
export const waitlistEntrySchema = z.object({
  id: uuidSchema,
  locality_id: uuidSchema,
  category_id: uuidSchema.nullable(),
  contact_phone: z.string(),
  contact_name: z.string().nullable(),
  status: z.enum(WAITLIST_STATUSES),
  consented_at: timestampSchema,
  contacted_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  locality: z.object({ name: z.string() }).nullable(),
  category: z.object({ name: z.string() }).nullable(),
});
export type WaitlistEntry = z.infer<typeof waitlistEntrySchema>;