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

/** Admin: create (no id) or rename/reorder/switch off (id) a subcategory. The category and web address never change. */
export const subcategoryInput = z.object({
  id: uuidSchema.optional(),
  category_id: uuidSchema.optional(),
  name: z.string().trim().min(2, "The name must be at least 2 characters").max(60, "The name must be 60 characters or fewer"),
  slug: z.string().trim().toLowerCase().max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "The web address may use lowercase letters, digits and single hyphens only").optional(),
  display_order: z.coerce.number().int().min(0).max(10000).default(100),
  is_active: z.boolean().default(true),
});
export type SubcategoryInput = z.infer<typeof subcategoryInput>;

export const ATTRIBUTE_TYPES = ["text", "number", "choice", "yes_no"] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** A question an administrator attached to a category (REQ-ADM-03). Row shape for public.category_attributes. */
export const categoryAttributeSchema = z.object({
  id: uuidSchema,
  category_id: uuidSchema,
  key: z.string(),
  label: z.string(),
  help_text: z.string().nullable(),
  field_type: z.enum(ATTRIBUTE_TYPES),
  options: z.array(z.string()),
  is_required: z.boolean(),
  display_order: z.number().int(),
  is_active: z.boolean(),
});
export type CategoryAttribute = z.infer<typeof categoryAttributeSchema>;

const keyPattern = /^[a-z][a-z0-9_]{1,39}$/;
/** Admin: define (no id) or edit (id) a question. The key and the answer type never change once created. */
export const categoryAttributeInput = z
  .object({
    id: uuidSchema.optional(),
    category_id: uuidSchema.optional(),
    key: z.string().trim().toLowerCase().optional(),
    label: z.string().trim().min(2, "The question must be at least 2 characters").max(80, "The question must be 80 characters or fewer"),
    help_text: z.string().trim().max(200, "The hint must be 200 characters or fewer").optional(),
    field_type: z.enum(ATTRIBUTE_TYPES).optional(),
    options: z.array(z.string().trim().min(1).max(40, "Each choice must be 40 characters or fewer")).max(12, "At most 12 choices").default([]),
    is_required: z.boolean().default(false),
    display_order: z.coerce.number().int().min(0).max(10000).default(100),
    is_active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (!v.id) {
      if (!v.category_id) ctx.addIssue({ code: "custom", path: ["category_id"], message: "Choose a category" });
      if (!v.key || !keyPattern.test(v.key)) {
        ctx.addIssue({ code: "custom", path: ["key"], message: "The short name must start with a letter and use only lowercase letters, digits and underscores (2 to 40 characters)" });
      }
      if (!v.field_type) ctx.addIssue({ code: "custom", path: ["field_type"], message: "Choose the kind of answer" });
    }
    if (v.field_type === "choice" || (v.id && v.options.length > 0)) {
      if (v.options.length < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "A list question needs at least two choices" });
      if (new Set(v.options.map((o) => o.toLowerCase())).size !== v.options.length) {
        ctx.addIssue({ code: "custom", path: ["options"], message: "Each choice must be different" });
      }
    }
  });
export type CategoryAttributeInput = z.infer<typeof categoryAttributeInput>;
