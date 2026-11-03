import { z } from "zod";
import { nonEmptyText, slugSchema, timestampSchema, uuidSchema } from "./common";
import { stockStatusSchema, visibilityStatusSchema } from "./enums";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MAX_QUERY_LENGTH } from "./discovery";

/** Mirrors the CHECK constraints added in migration 007. */
export const MAX_PRODUCTS_PER_SHOP = 500;
export const MAX_PRICE = 10_000_000;

/** Rupees with at most two decimals. */
const money = z
  .number({ error: "Enter an amount in rupees" })
  .min(0, "The amount cannot be negative")
  .max(MAX_PRICE, "The amount is too large")
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Use at most two decimal places");

/** What a manager may set on an item. Stock confirmation time is stamped by the database. */
const productFields = z.object({
  name: nonEmptyText(160),
  name_te: nonEmptyText(160).nullable(),
  description: z.string().trim().max(1000).nullable(),
  price: money.nullable(),
  mrp: money.nullable(),
  unit: nonEmptyText(30).nullable(),
  stock_status: stockStatusSchema,
  is_published: z.boolean(),
});

const mrpNotBelowPrice = (v: { price?: number | null; mrp?: number | null }) =>
  v.price == null || v.mrp == null || v.mrp >= v.price;
const MRP_MESSAGE = { message: "MRP cannot be lower than the selling price", path: ["mrp"] };

export const createProductInput = productFields
  .partial({ name_te: true, description: true, price: true, mrp: true, unit: true, stock_status: true, is_published: true })
  .transform((v) => ({
    name_te: null,
    description: null,
    price: null,
    mrp: null,
    unit: null,
    // Unknown stock is never shown as "In stock" (REQ-SRC-04).
    stock_status: "call_to_confirm" as const,
    is_published: true,
    ...v,
  }))
  .refine(mrpNotBelowPrice, MRP_MESSAGE);
export type CreateProductInput = z.input<typeof createProductInput>;

export const updateProductInput = productFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update" })
  .refine(mrpNotBelowPrice, MRP_MESSAGE);
export type UpdateProductInput = z.input<typeof updateProductInput>;

/** A row of public.products_with_stock (storefront_products plus the effective stock label). */
export const productSchema = z.object({
  id: uuidSchema,
  shop_id: uuidSchema,
  name: z.string(),
  name_te: z.string().nullable(),
  description: z.string().nullable(),
  price: z.number().nullable(),
  mrp: z.number().nullable(),
  unit: z.string().nullable(),
  stock_status: stockStatusSchema,
  stock_confirmed_at: timestampSchema.nullable(),
  /** Stale or unconfirmed stock reads `call_to_confirm`; show this one to customers. */
  effective_stock_status: stockStatusSchema,
  image_url: z.string().nullable(),
  display_order: z.number(),
  is_published: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export type Product = z.infer<typeof productSchema>;

export const PRODUCT_SORTS = ["relevance", "price_asc", "price_desc"] as const;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const searchProductsInput = z.object({
  q: z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, "Enter an item to search for").max(MAX_QUERY_LENGTH)),
  locality_id: z.preprocess(blankToUndefined, uuidSchema.optional()),
  category_id: z.preprocess(blankToUndefined, uuidSchema.optional()),
  sort: z.preprocess(blankToUndefined, z.enum(PRODUCT_SORTS).default("relevance")),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)),
  offset: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(10000).default(0)),
});
export type SearchProductsInput = z.infer<typeof searchProductsInput>;

export const productResultSchema = z.object({
  product_id: uuidSchema,
  name: z.string(),
  name_te: z.string().nullable(),
  unit: z.string().nullable(),
  price: z.number().nullable(),
  mrp: z.number().nullable(),
  image_url: z.string().nullable(),
  effective_stock_status: stockStatusSchema,
  shop_name: z.string(),
  storefront_slug: slugSchema,
  locality_name: z.string(),
  locality_slug: z.string(),
  category_name: z.string(),
  rank: z.number(),
  total_count: z.coerce.number(),
});
export type ProductResult = z.infer<typeof productResultSchema>;

/** Admin moderation of a storefront; a reason is mandatory when taking it offline. */
export const visibilityInput = z
  .object({
    status: visibilityStatusSchema,
    reason: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.status === "visible" || (v.reason?.length ?? 0) >= 3, {
    message: "Give a reason (at least 3 characters) when hiding or suspending a storefront",
    path: ["reason"],
  });
export type VisibilityInput = z.infer<typeof visibilityInput>;

export const adminStorefrontRowSchema = z.object({
  id: uuidSchema,
  slug: slugSchema,
  is_published: z.boolean(),
  visibility_status: visibilityStatusSchema,
  visibility_reason: z.string().nullable(),
  visibility_changed_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  shop: z.object({
    name: z.string(),
    is_active: z.boolean(),
    locality: z.object({ name: z.string() }).nullable(),
    category: z.object({ name: z.string() }).nullable(),
    business: z.object({ name: z.string() }).nullable(),
  }),
});
export type AdminStorefrontRow = z.infer<typeof adminStorefrontRowSchema>;
