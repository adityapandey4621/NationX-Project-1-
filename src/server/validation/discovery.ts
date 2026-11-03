import { z } from "zod";
import { slugSchema, timestampSchema, uuidSchema } from "./common";
import { operatingModelSchema, stockStatusSchema, storefrontTemplateSchema } from "./enums";
import { operatingHoursSchema } from "./storefront";

export const SEARCH_SORTS = ["relevance", "newest", "name", "nearest"] as const;
export const searchSortSchema = z.enum(SEARCH_SORTS);
export type SearchSort = z.infer<typeof searchSortSchema>;

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 50;
export const MAX_QUERY_LENGTH = 80;

/** Blank query-string values mean "not provided". */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/**
 * Search request (API query string or server-rendered page). Control
 * characters are stripped and the length capped; the database applies its own
 * limits as well (defence in depth).
 */
export const searchInput = z.object({
  q: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim())
      .pipe(z.string().max(MAX_QUERY_LENGTH))
      .optional(),
  ),
  category_id: z.preprocess(blankToUndefined, uuidSchema.optional()),
  locality_id: z.preprocess(blankToUndefined, uuidSchema.optional()),
  model: z.preprocess(blankToUndefined, operatingModelSchema.optional()),
  sort: z.preprocess(blankToUndefined, searchSortSchema.default("relevance")),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE)),
  offset: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(10000).default(0)),
  /** Optional visitor position (opt-in "near me"). Used for this request only; never stored. */
  /** Internal: limit to these storefronts (used for featured shops). Not exposed by the public API route. */
  ids: z.array(uuidSchema).max(24).optional(),
  lat: z.preprocess(blankToUndefined, z.coerce.number().min(-90).max(90).optional()),
  lng: z.preprocess(blankToUndefined, z.coerce.number().min(-180).max(180).optional()),
});
export type SearchInput = z.infer<typeof searchInput>;

/** One published shop as returned by search_storefronts(). */
export const searchResultSchema = z.object({
  storefront_id: uuidSchema,
  slug: slugSchema,
  shop_id: uuidSchema,
  shop_name: z.string(),
  headline: z.string().nullable(),
  snippet: z.string().nullable(),
  logo_url: z.string().nullable(),
  category_name: z.string(),
  category_slug: z.string(),
  locality_name: z.string(),
  locality_slug: z.string(),
  operating_models: z.array(operatingModelSchema),
  created_at: timestampSchema,
  rank: z.number(),
  total_count: z.coerce.number(),
  // Added by migration 009. Defaults keep older rows/mocks valid.
  banner_url: z.string().nullable().default(null),
  template_name: storefrontTemplateSchema.default("standard_retail"),
  /** The shop's own recorded hours (self-reported); null if unusable. */
  operating_hours: operatingHoursSchema.nullable().catch(null).default(null),
  /** Number of PUBLISHED items; 0 means the shop has no showcase yet. */
  item_count: z.coerce.number().default(0),
  /** True only for development sample listings (never set in production). */
  is_sample: z.boolean().default(false),
  /** Great-circle km from the visitor, only when they shared a position AND the shop has coordinates. */
  distance_km: z.number().nullable().catch(null).default(null),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/** Newest published items (homepage strip). */
export const recentProductSchema = z.object({
  product_id: uuidSchema,
  name: z.string(),
  name_te: z.string().nullable(),
  unit: z.string().nullable(),
  price: z.coerce.number().nullable(),
  mrp: z.coerce.number().nullable(),
  image_url: z.string().nullable(),
  effective_stock_status: stockStatusSchema,
  shop_name: z.string(),
  storefront_slug: slugSchema,
  locality_name: z.string(),
  locality_slug: z.string(),
  category_name: z.string(),
  category_slug: z.string(),
  template_name: storefrontTemplateSchema,
  is_sample: z.boolean(),
});
export type RecentProduct = z.infer<typeof recentProductSchema>;

export const categoryCountSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  display_order: z.number(),
  shop_count: z.coerce.number(),
  default_template: storefrontTemplateSchema.default("standard_retail"),
});
export type CategoryCount = z.infer<typeof categoryCountSchema>;

export const localityCountSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: slugSchema,
  district: z.string(),
  shop_count: z.coerce.number(),
});
export type LocalityCount = z.infer<typeof localityCountSchema>;

export const featureFlagSchema = z.object({
  key: z.string(),
  is_enabled: z.boolean(),
  enabled_localities: z.array(uuidSchema),
});
export type FeatureFlag = z.infer<typeof featureFlagSchema>;

/** Real aggregate counts of live (verified, published, non-sample) shops per area. */
export const communityStatSchema = z.object({
  locality_slug: z.string(),
  locality_name: z.string(),
  shop_count: z.coerce.number(),
  joined_30d: z.coerce.number(),
  last_joined_at: timestampSchema.nullable(),
});
export type CommunityStat = z.infer<typeof communityStatSchema>;
