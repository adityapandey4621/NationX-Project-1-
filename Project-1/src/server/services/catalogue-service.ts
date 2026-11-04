import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  adminStorefrontRowSchema,
  createProductInput,
  productResultSchema,
  productSchema,
  searchProductsInput,
  updateProductInput,
  uuidSchema,
  visibilityInput,
  type AdminStorefrontRow,
  type CreateProductInput,
  type Product,
  type ProductResult,
  type UpdateProductInput,
  type VisibilityInput,
} from "../validation";
import { fromPostgrest, ServiceError } from "./service-result";

/**
 * Items a shop lists. Write access is owner/manager (RLS on storefront_products);
 * these functions never trust a caller-supplied shop for authorisation - every
 * statement is scoped by shop id AND product id and the database decides.
 */

/** Everything the shop's managers/employees see, including unpublished items. */
export async function listShopProducts(db: SupabaseClient, shopId: string): Promise<Product[]> {
  const { data, error } = await db
    .from("products_with_stock")
    .select("*")
    .eq("shop_id", uuidSchema.parse(shopId))
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw fromPostgrest(error, "listShopProducts");
  return z.array(productSchema).parse(data);
}

/**
 * The public showcase. The `is_published` filter is explicit because owners
 * viewing their own public URL can otherwise read their unpublished items too.
 */
export async function listPublicProducts(db: SupabaseClient, shopId: string): Promise<Product[]> {
  const { data, error } = await db
    .from("products_with_stock")
    .select("*")
    .eq("shop_id", uuidSchema.parse(shopId))
    .eq("is_published", true)
    .order("display_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw fromPostgrest(error, "listPublicProducts");
  return z.array(productSchema).parse(data);
}

export async function createProduct(db: SupabaseClient, shopId: string, input: CreateProductInput): Promise<{ id: string }> {
  const fields = createProductInput.parse(input);
  const { data, error } = await db
    .from("storefront_products")
    .insert({ ...fields, shop_id: uuidSchema.parse(shopId) })
    .select("id")
    .single();
  if (error) throw fromPostgrest(error, "createProduct");
  return z.object({ id: uuidSchema }).parse(data);
}

export async function updateProduct(
  db: SupabaseClient,
  shopId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<void> {
  const patch = updateProductInput.parse(input);
  const { data, error } = await db
    .from("storefront_products")
    .update(patch)
    .eq("id", uuidSchema.parse(productId))
    .eq("shop_id", uuidSchema.parse(shopId))
    .select("id")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "updateProduct");
  // RLS filtered the row out (not a member / not a manager) or it does not exist.
  if (!data) throw new ServiceError("NOT_FOUND", "Item not found");
}

export async function deleteProduct(db: SupabaseClient, shopId: string, productId: string): Promise<void> {
  const { data, error } = await db
    .from("storefront_products")
    .delete()
    .eq("id", uuidSchema.parse(productId))
    .eq("shop_id", uuidSchema.parse(shopId))
    .select("id")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "deleteProduct");
  if (!data) throw new ServiceError("NOT_FOUND", "Item not found");
}

/**
 * "I re-checked the shelf": the database replaces whatever is sent with now(),
 * so the confirmation time cannot be forged or backdated by the client.
 */
export async function confirmProductStock(db: SupabaseClient, shopId: string, productId: string): Promise<void> {
  const { data, error } = await db
    .from("storefront_products")
    .update({ stock_confirmed_at: new Date().toISOString() })
    .eq("id", uuidSchema.parse(productId))
    .eq("shop_id", uuidSchema.parse(shopId))
    .select("id")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "confirmProductStock");
  if (!data) throw new ServiceError("NOT_FOUND", "Item not found");
}

export async function setProductImage(
  db: SupabaseClient,
  shopId: string,
  productId: string,
  url: string | null,
): Promise<void> {
  const { data, error } = await db
    .from("storefront_products")
    .update({ image_url: url })
    .eq("id", uuidSchema.parse(productId))
    .eq("shop_id", uuidSchema.parse(shopId))
    .select("id")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "setProductImage");
  if (!data) throw new ServiceError("NOT_FOUND", "Item not found");
}

export interface ProductSearchPage {
  results: ProductResult[];
  total: number;
  limit: number;
  offset: number;
}

/** Find items by name (English or Telugu). Published items of live shops only - enforced in SQL. */
export async function searchProducts(db: SupabaseClient, raw: unknown): Promise<ProductSearchPage> {
  const input = searchProductsInput.parse(raw);
  const { data, error } = await db.rpc("search_products", {
    p_query: input.q,
    p_locality_id: input.locality_id ?? null,
    p_category_id: input.category_id ?? null,
    p_sort: input.sort,
    p_limit: input.limit,
    p_offset: input.offset,
  });
  if (error) throw fromPostgrest(error, "searchProducts");
  const results = z.array(productResultSchema).parse(data);
  return { results, total: results[0]?.total_count ?? 0, limit: input.limit, offset: input.offset };
}

/** A result as exposed over the API: the page-level total is reported once. */
export function toApiProduct(result: ProductResult) {
  const { total_count, ...product } = result;
  void total_count;
  return product;
}

/* ---------------------------------------------------------------- admin oversight */

export interface AdminStorefrontQuery {
  q?: string;
  status?: "visible" | "hidden" | "suspended";
  /** Only shops in this area / category (validated UUIDs). */
  locality_id?: string;
  category_id?: string;
  limit?: number;
  offset?: number;
}

/** Storefront oversight list (REQ-ADM-02). Admin RLS lets this read every storefront. */
export async function listStorefrontsForAdmin(
  db: SupabaseClient,
  query: AdminStorefrontQuery = {},
): Promise<{ rows: AdminStorefrontRow[]; total: number }> {
  const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  let req = db
    .from("storefronts")
    .select(
      "id, slug, is_published, visibility_status, visibility_reason, visibility_changed_at, created_at, " +
        "shop:shops!inner(name, is_active, locality:localities(name), category:categories(name), business:businesses(name))",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (query.status) req = req.eq("visibility_status", query.status);
  if (query.locality_id) req = req.eq("shops.locality_id", uuidSchema.parse(query.locality_id));
  if (query.category_id) req = req.eq("shops.category_id", uuidSchema.parse(query.category_id));
  // Strip characters that are special in LIKE patterns or PostgREST filter syntax.
  const term = (query.q ?? "").replace(/[%_\\,()*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (term) req = req.ilike("shops.name", `%${term}%`);
  const { data, error, count } = await req;
  if (error) throw fromPostgrest(error, "listStorefrontsForAdmin");
  return { rows: z.array(adminStorefrontRowSchema).parse(data), total: count ?? 0 };
}

/** Hide, suspend or reactivate. Admin-only in SQL; reason mandatory offline; audited there too. */
export async function setStorefrontVisibility(
  db: SupabaseClient,
  storefrontId: string,
  input: VisibilityInput,
): Promise<{ status: string; changed: boolean }> {
  const { status, reason } = visibilityInput.parse(input);
  const { data, error } = await db.rpc("set_storefront_visibility", {
    p_storefront_id: uuidSchema.parse(storefrontId),
    p_status: status,
    p_reason: reason ?? null,
  });
  if (error) throw fromPostgrest(error, "setStorefrontVisibility");
  return z.object({ status: z.string(), changed: z.boolean() }).parse(data);
}
