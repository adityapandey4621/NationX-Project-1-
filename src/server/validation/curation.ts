import { z } from "zod";
import { nonEmptyText, pincodeSchema, slugSchema, timestampSchema, uuidSchema } from "./common";
import { storefrontTemplateSchema } from "./enums";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

/** Same rule as the database CHECK: a site path, or an https URL. Never javascript: or http:. */
export const bannerLinkSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || /^\/[A-Za-z0-9/_?=&.-]*$/.test(v) || /^https:\/\/\S+$/.test(v), "Use a page on this site (like /explore) or an https:// link")
  .optional()
  .transform((v) => (v ? v : undefined));

export const bannerInput = z.object({
  title: nonEmptyText(80).refine((s) => s.length >= 2, "Give the banner a title"),
  body: optionalText(200),
  link_url: bannerLinkSchema,
  locality_id: z.preprocess((v) => (v === "" ? undefined : v), uuidSchema.optional()),
  display_order: z.coerce.number().int().min(0).max(1000).default(0),
});
export type BannerInput = z.infer<typeof bannerInput>;

export const bannerSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  body: z.string().nullable(),
  link_url: z.string().nullable(),
  locality_id: uuidSchema.nullable(),
  display_order: z.number().int(),
  is_active: z.boolean(),
  starts_at: timestampSchema.nullable(),
  ends_at: timestampSchema.nullable(),
});
export type Banner = z.infer<typeof bannerSchema>;

export const featuredInput = z.object({
  storefront_id: uuidSchema,
  locality_id: z.preprocess((v) => (v === "" ? undefined : v), uuidSchema.optional()),
  position: z.coerce.number().int().min(0).max(1000).default(0),
});
export const featuredRowSchema = z.object({ id: uuidSchema, storefront_id: uuidSchema, locality_id: uuidSchema.nullable(), position: z.number().int() });
export type FeaturedRow = z.infer<typeof featuredRowSchema>;

/** Admin taxonomy management (REQ-ADM-03). */
export const categoryCreateInput = z.object({
  name: nonEmptyText(60).refine((s) => s.length >= 2, "Give the category a name"),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  default_template: storefrontTemplateSchema.default("standard_retail"),
  display_order: z.coerce.number().int().min(0).max(1000).default(100),
});
export const categoryUpdateInput = z.object({
  name: nonEmptyText(60).optional(),
  is_active: z.boolean().optional(),
  display_order: z.coerce.number().int().min(0).max(1000).optional(),
  default_template: storefrontTemplateSchema.optional(),
});
export const localityCreateInput = z.object({
  name: nonEmptyText(80).refine((s) => s.length >= 2, "Give the area a name"),
  slug: z.preprocess((v) => (v === "" ? undefined : v), slugSchema.optional()),
  district: nonEmptyText(80),
  pincode: pincodeSchema,
});
export const localityUpdateInput = z.object({ name: nonEmptyText(80).optional(), is_active: z.boolean().optional() });

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}