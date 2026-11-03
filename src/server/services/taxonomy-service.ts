import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  categorySchema,
  localitySchema,
  slugSchema,
  subcategorySchema,
  uuidSchema,
  type Category,
  type Locality,
  type Subcategory,
} from "../validation";
import { fromPostgrest } from "./service-result";

/** Active Khammam localities for the locality selector and onboarding form. */
export async function listActiveLocalities(db: SupabaseClient): Promise<Locality[]> {
  const { data, error } = await db
    .from("localities")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw fromPostgrest(error, "listActiveLocalities");
  return z.array(localitySchema).parse(data);
}

/** Active top-level categories in admin-defined display order. */
export async function listActiveCategories(db: SupabaseClient): Promise<Category[]> {
  const { data, error } = await db
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("display_order")
    .order("name");
  if (error) throw fromPostgrest(error, "listActiveCategories");
  return z.array(categorySchema).parse(data);
}

/** Resolve a URL slug to an active category / locality (null when unknown or inactive). */
export async function findCategoryBySlug(db: SupabaseClient, slug: string): Promise<Category | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const { data, error } = await db.from("categories").select("*").eq("slug", parsed.data).eq("is_active", true).maybeSingle();
  if (error) throw fromPostgrest(error, "findCategoryBySlug");
  return data ? categorySchema.parse(data) : null;
}

export async function findLocalityBySlug(db: SupabaseClient, slug: string): Promise<Locality | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const { data, error } = await db.from("localities").select("*").eq("slug", parsed.data).eq("is_active", true).maybeSingle();
  if (error) throw fromPostgrest(error, "findLocalityBySlug");
  return data ? localitySchema.parse(data) : null;
}

export async function listActiveSubcategories(
  db: SupabaseClient,
  categoryId: string,
): Promise<Subcategory[]> {
  const id = uuidSchema.parse(categoryId);
  const { data, error } = await db
    .from("subcategories")
    .select("*")
    .eq("category_id", id)
    .eq("is_active", true)
    .order("display_order")
    .order("name");
  if (error) throw fromPostgrest(error, "listActiveSubcategories");
  return z.array(subcategorySchema).parse(data);
}
