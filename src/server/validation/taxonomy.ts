import { z } from "zod";
import { slugSchema, timestampSchema, uuidSchema } from "./common";

/** Row shapes for public.localities / categories / subcategories. */

export const localitySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  district: z.string(),
  state: z.string(),
  pincode: z.string(),
  is_active: z.boolean(),
  created_at: timestampSchema,
});
export type Locality = z.infer<typeof localitySchema>;

export const categorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  icon_url: z.string().nullable(),
  display_order: z.number().int(),
  is_active: z.boolean(),
  created_at: timestampSchema,
  /** Storefront template new shops in this category get; drives the category-adaptive application form. */
  default_template: z.enum(["grocery", "standard_retail", "service_provider", "artisan"]).catch("standard_retail").default("standard_retail"),
});
export type Category = z.infer<typeof categorySchema>;

export const subcategorySchema = z.object({
  id: uuidSchema,
  category_id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  display_order: z.number().int(),
  is_active: z.boolean(),
  created_at: timestampSchema,
});
export type Subcategory = z.infer<typeof subcategorySchema>;
