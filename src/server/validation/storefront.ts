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
import { weekdaySchema } from "./merchant-application";
import {
  businessMemberRoleSchema,
  operatingModelSchema,
  storefrontActionSchema,
  storefrontTemplateSchema,
  visibilityStatusSchema,
} from "./enums";

/** Row shapes for public.businesses / business_members / shops / storefronts. */

export const businessSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  legal_name: z.string().nullable(),
  pan_number: z.string().nullable(),
  gstin: z.string().nullable(),
  primary_owner_id: uuidSchema,
  origin_application_id: uuidSchema.nullable(),
  is_verified: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Business = z.infer<typeof businessSchema>;

export const businessMemberSchema = z.object({
  id: uuidSchema,
  business_id: uuidSchema,
  user_id: uuidSchema,
  role: businessMemberRoleSchema,
  created_at: timestampSchema,
});

export const operatingHoursSchema = z.object({
  opens: timeOfDaySchema,
  closes: timeOfDaySchema,
  closed_days: z.array(z.string()),
});
export type OperatingHours = z.infer<typeof operatingHoursSchema>;

export const shopSchema = z.object({
  id: uuidSchema,
  business_id: uuidSchema,
  name: z.string(),
  shop_code: z.string(),
  category_id: uuidSchema,
  subcategory_id: uuidSchema.nullable(),
  locality_id: uuidSchema,
  address_line: z.string(),
  landmark: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  pincode: z.string().nullable(),
  phone: z.string(),
  whatsapp: z.string().nullable(),
  operating_models: z.array(operatingModelSchema),
  operating_hours: operatingHoursSchema,
  is_active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Shop = z.infer<typeof shopSchema>;

export const storefrontSchema = z.object({
  id: uuidSchema,
  shop_id: uuidSchema,
  slug: slugSchema,
  headline: z.string().nullable(),
  description: z.string().nullable(),
  logo_url: z.string().nullable(),
  banner_url: z.string().nullable(),
  gallery_urls: z.array(z.string()),
  template_name: storefrontTemplateSchema,
  is_published: z.boolean(),
  visibility_status: visibilityStatusSchema,
  /** Why an administrator took the storefront offline; null while visible. */
  visibility_reason: z.string().nullable(),
  visibility_changed_at: timestampSchema.nullable(),
  supported_actions: z.array(storefrontActionSchema),
  ordering_enabled: z.boolean(),
  /** Development sample listing (migration 009); always false in production. */
  is_sample: z.boolean().default(false),
  meta_title: z.string().nullable(),
  meta_description: z.string().nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Storefront = z.infer<typeof storefrontSchema>;

/**
 * Fields a merchant may change on their own shop/storefront (Phase 6).
 * Platform-controlled fields (slug, publication, visibility, ordering,
 * template) are deliberately absent: they are also blocked by DB triggers.
 */
export const updateShopDetailsInput = z
  .object({
    phone: phoneSchema,
    whatsapp: phoneSchema.nullable(),
    address_line: nonEmptyText(400),
    landmark: nonEmptyText(200).nullable(),
    pincode: pincodeSchema.nullable(),
    latitude: latitudeSchema.nullable(),
    longitude: longitudeSchema.nullable(),
    operating_hours: operatingHoursSchema.extend({ closed_days: z.array(weekdaySchema).max(7) }),
    operating_models: z.array(operatingModelSchema).min(1),
    headline: nonEmptyText(160).nullable(),
    description: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" })
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: "latitude and longitude must be provided together",
  });
export type UpdateShopDetailsInput = z.infer<typeof updateShopDetailsInput>;

/** Everything the public storefront page renders (anon-readable under RLS). */
export const publicStorefrontSchema = storefrontSchema.extend({
  shop: shopSchema.extend({
    locality: z.object({ name: z.string(), slug: z.string(), pincode: z.string() }),
    category: z.object({ name: z.string(), slug: z.string() }),
  }),
});
export type PublicStorefront = z.infer<typeof publicStorefrontSchema>;

/** A storefront the signed-in user may manage, with its shop and business. */
export const managedShopSchema = shopSchema.extend({
  locality: z.object({ name: z.string() }),
  category: z.object({ name: z.string() }),
  storefront: storefrontSchema.nullable(),
});
export type ManagedShop = z.infer<typeof managedShopSchema>;
