import { z } from "zod";
import {
  latitudeSchema,
  longitudeSchema,
  nonEmptyText,
  phoneSchema,
  pincodeSchema,
  slugSchema,
  timeOfDaySchema,
  timestampSchema,
  uuidSchema,
} from "./common";
import { applicationStatusSchema, operatingModelSchema } from "./enums";

/** Row shape for public.merchant_applications. */
export const merchantApplicationSchema = z.object({
  id: uuidSchema,
  applicant_user_id: uuidSchema,
  business_name: z.string(),
  category_id: uuidSchema,
  subcategory_id: uuidSchema.nullable(),
  contact_phone: z.string(),
  contact_email: z.string().nullable(),
  whatsapp_number: z.string().nullable(),
  address_line1: z.string(),
  address_line2: z.string().nullable(),
  locality_id: uuidSchema,
  pincode: z.string().nullable(),
  landmark: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  opening_time: timeOfDaySchema.nullable(),
  closing_time: timeOfDaySchema.nullable(),
  weekly_off_days: z.array(z.string()).nullable(),
  business_description: z.string().nullable(),
  logo_storage_path: z.string().nullable(),
  photos_storage_paths: z.array(z.string()).nullable(),
  document_storage_paths: z.array(z.string()).nullable(),
  operating_models: z.array(operatingModelSchema),
  category_specific_data: z.record(z.string(), z.unknown()),
  declaration_accepted: z.boolean(),
  status: applicationStatusSchema,
  rejection_reason: z.string().nullable(),
  correction_notes: z.string().nullable(),
  reviewed_by: uuidSchema.nullable(),
  reviewed_at: timestampSchema.nullable(),
  associated_business_id: uuidSchema.nullable(),
  /** The content the administrator saw when corrections were last requested (migration 021); null if never. */
  review_snapshot: z.record(z.string(), z.unknown()).nullable().default(null),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type MerchantApplication = z.infer<typeof merchantApplicationSchema>;

import { WEEKDAYS } from "./constants";
export { WEEKDAYS };
export const weekdaySchema = z.enum(WEEKDAYS);

/** Statuses in which the applicant may still edit the application content. */
export const EDITABLE_APPLICATION_STATUSES = ["draft", "correction_requested"] as const;

/**
 * Fields an applicant may supply. Never includes status, review fields or
 * applicant_user_id: those are set by the server from the session / workflow.
 */
const applicationFields = z.object({
  business_name: nonEmptyText(200),
  category_id: uuidSchema,
  subcategory_id: uuidSchema.nullable().optional(),
  contact_phone: phoneSchema,
  contact_email: z.email().nullable().optional(),
  whatsapp_number: phoneSchema.nullable().optional(),
  address_line1: nonEmptyText(300),
  address_line2: nonEmptyText(300).nullable().optional(),
  locality_id: uuidSchema,
  pincode: pincodeSchema.nullable().optional(),
  landmark: nonEmptyText(200).nullable().optional(),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  opening_time: timeOfDaySchema.nullable().optional(),
  closing_time: timeOfDaySchema.nullable().optional(),
  weekly_off_days: z.array(weekdaySchema).max(7).optional(),
  business_description: z.string().trim().max(2000).nullable().optional(),
  logo_storage_path: z.string().max(300).optional(),
  photos_storage_paths: z.array(z.string().max(300)).max(8).optional(),
  document_storage_paths: z.array(z.string().max(300)).max(10).optional(),
  operating_models: z.array(operatingModelSchema).min(1).default(["visit_only"]),
  category_specific_data: z.record(z.string(), z.unknown()).default({}),
  declaration_accepted: z.boolean().default(false),
});

const coordinatesTogether = (v: { latitude?: number | null | undefined; longitude?: number | null | undefined }) =>
  (v.latitude == null) === (v.longitude == null);
const COORDS_MESSAGE = { message: "latitude and longitude must be provided together" };

const hoursTogether = (v: { opening_time?: string | null | undefined; closing_time?: string | null | undefined }) =>
  (v.opening_time == null) === (v.closing_time == null);
const HOURS_MESSAGE = { message: "Provide both opening and closing time, or neither" };

/**
 * Saving a draft: the columns that are NOT NULL in the database are required;
 * everything else may be completed later.
 */
export const saveApplicationDraftInput = applicationFields
  .partial()
  .required({
    business_name: true,
    category_id: true,
    locality_id: true,
    contact_phone: true,
    address_line1: true,
  })
  .refine(coordinatesTogether, COORDS_MESSAGE)
  .refine(hoursTogether, HOURS_MESSAGE);
export type SaveApplicationDraftInput = z.infer<typeof saveApplicationDraftInput>;

/** Submitting for review: full field set plus the mandatory declaration. */
export const submitApplicationInput = applicationFields
  .extend({ declaration_accepted: z.literal(true, "The declaration must be accepted") })
  .refine(coordinatesTogether, COORDS_MESSAGE)
  .refine(hoursTogether, HOURS_MESSAGE);
export type SubmitApplicationInput = z.infer<typeof submitApplicationInput>;

/** Admin review decisions (docs/API_CONTRACTS.md section 5). Notes are mandatory for reject/corrections. */
export const approveApplicationInput = z.object({
  review_notes: z.string().trim().max(1000).optional(),
  assigned_category_id: uuidSchema.optional(),
  custom_slug: slugSchema.max(100).optional(),
});
export type ApproveApplicationInput = z.infer<typeof approveApplicationInput>;
export const rejectApplicationInput = z.object({ reason: nonEmptyText(1000) });
export const requestCorrectionsInput = z.object({ notes: nonEmptyText(2000) });
