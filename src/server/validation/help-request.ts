import { z } from "zod";
import { nonEmptyText, phoneSchema, timestampSchema, uuidSchema } from "./common";
import { hmfStatusSchema } from "./enums";

/** Request body for creating a Help Me Find It request. */
export const submitHelpRequestInput = z.object({
  item_name: nonEmptyText(200).refine((s) => s.length >= 2, "Describe what you are looking for"),
  item_description: z.string().trim().max(1000).optional(),
  preferred_locality_id: uuidSchema,
  category_id: uuidSchema.optional(),
  contact_name: nonEmptyText(120),
  contact_phone: phoneSchema,
  contact_email: z.email().max(254).optional(),
  consent_given: z.literal(true, "Please agree to be contacted about this request"),
});
export type SubmitHelpRequestInput = z.infer<typeof submitHelpRequestInput>;

export const submitHelpRequestResultSchema = z.object({
  tracking_id: z.string(),
  status: hmfStatusSchema,
});

/** Row shape as seen by the owning customer / staff. */
export const helpRequestSchema = z.object({
  id: uuidSchema,
  tracking_id: z.string(),
  customer_user_id: uuidSchema.nullable(),
  item_name: z.string(),
  item_description: z.string().nullable(),
  preferred_locality_id: uuidSchema,
  category_id: uuidSchema.nullable(),
  contact_name: z.string(),
  contact_phone: z.string(),
  contact_email: z.string().nullable(),
  status: hmfStatusSchema,
  matched_shop_id: uuidSchema.nullable(),
  resolution_notes: z.string().nullable(),
  operator_id: uuidSchema.nullable(),
  resolved_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const helpRequestWithJoinsSchema = helpRequestSchema.extend({
  locality: z.object({ name: z.string() }).nullable(),
  category: z.object({ name: z.string() }).nullable(),
  matched_shop: z
    .object({ name: z.string(), storefront: z.object({ slug: z.string() }).nullable() })
    .nullable(),
});
export type HelpRequest = z.infer<typeof helpRequestWithJoinsSchema>;

/** Anonymous status lookup: BOTH the tracking id and the phone number are required. */
export const trackHelpRequestInput = z.object({
  tracking_id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^HMF-[A-Z]{3}-\d{6}-\d{4,}$/, "Enter your tracking ID, e.g. HMF-KHM-202611-0001"),
  contact_phone: phoneSchema,
});

export const trackedHelpRequestSchema = z.object({
  tracking_id: z.string(),
  status: hmfStatusSchema,
  item_name: z.string(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  resolution_notes: z.string().nullable(),
  matched_shop_slug: z.string().nullable(),
});
export type TrackedHelpRequest = z.infer<typeof trackedHelpRequestSchema>;

/** Staff decision. The database enforces the allowed transitions and the matched/unresolved rules. */
export const updateHelpRequestInput = z.object({
  status: z.enum(["under_review", "matched", "unresolved", "cancelled"]),
  notes: z.string().trim().max(1000).optional(),
  matched_shop_slug: z.string().trim().max(120).optional(),
});
export type UpdateHelpRequestInput = z.infer<typeof updateHelpRequestInput>;
