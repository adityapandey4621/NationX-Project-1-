import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  categoryAttributeInput,
  categoryAttributeSchema,
  categoryCreateInput,
  categorySchema,
  categoryUpdateInput,
  localityCreateInput,
  localitySchema,
  localityUpdateInput,
  slugify,
  subcategoryInput,
  subcategorySchema,
  type Category,
  type CategoryAttribute,
  type Locality,
  type Subcategory,
} from "../validation";
import { fromPostgrest, ServiceError } from "./service-result";

/** Database refusals the administrator can act on, in plain words. */
function adminError(e: ReturnType<typeof fromPostgrest>, duplicate: string): ServiceError {
  if (e.code === "CONFLICT") return new ServiceError("CONFLICT", duplicate, e.cause);
  if (e.code === "VALIDATION_ERROR") return e; // the database's own sentence is deliberate and user-safe
  if (e.code === "NOT_FOUND") return new ServiceError("NOT_FOUND", "That category, subcategory or question no longer exists", e.cause);
  return e;
}

/** Every subcategory, active or not (administrators only; others only ever see the active ones). */
export async function listAllSubcategories(db: SupabaseClient): Promise<Subcategory[]> {
  const { data, error } = await db.from("subcategories").select("*").order("display_order").order("name");
  if (error) throw fromPostgrest(error, "listAllSubcategories");
  return z.array(subcategorySchema).parse(data);
}

/** Every question, including switched-off ones (administrators only). */
export async function listAllCategoryAttributes(db: SupabaseClient): Promise<CategoryAttribute[]> {
  const { data, error } = await db.from("category_attributes").select("*").order("display_order").order("label");
  if (error) throw fromPostgrest(error, "listAllCategoryAttributes");
  return z.array(categoryAttributeSchema).parse(data);
}

/** Create (no id) or edit (id) a subcategory through the audited database function. */
export async function saveSubcategory(db: SupabaseClient, raw: unknown): Promise<string> {
  const i = subcategoryInput.parse(raw);
  if (!i.id && (!i.category_id || !i.slug)) throw new ServiceError("VALIDATION_ERROR", "Choose a category and give the subcategory a web address");
  const { data, error } = await db.rpc("admin_save_subcategory", {
    p_id: i.id ?? null,
    p_category_id: i.category_id ?? null,
    p_name: i.name,
    p_slug: i.slug ?? null,
    p_display_order: i.display_order,
    p_is_active: i.is_active,
  });
  if (error) throw adminError(fromPostgrest(error, "saveSubcategory"), "A subcategory with that web address already exists");
  return z.uuid().parse(data);
}

/** Define (no id) or edit (id) a category question through the audited database function. */
export async function saveCategoryAttribute(db: SupabaseClient, raw: unknown): Promise<string> {
  const i = categoryAttributeInput.parse(raw);
  const { data, error } = await db.rpc("admin_save_category_attribute", {
    p_id: i.id ?? null,
    p_category_id: i.category_id ?? null,
    p_key: i.key ?? null,
    p_label: i.label,
    p_help_text: i.help_text ?? null,
    p_field_type: i.field_type ?? null,
    p_options: i.options,
    p_is_required: i.is_required,
    p_display_order: i.display_order,
    p_is_active: i.is_active,
  });
  if (error) throw adminError(fromPostgrest(error, "saveCategoryAttribute"), "That category already has a question with that short name");
  return z.uuid().parse(data);
}

/** Everything, active or not (admins only: the public policies hide inactive rows). */
export async function listAllCategories(db: SupabaseClient): Promise<Category[]> {
  const { data, error } = await db.from("categories").select("*").order("display_order").order("name");
  if (error) throw fromPostgrest(error, "listAllCategories");
  return z.array(categorySchema).parse(data);
}
export async function listAllLocalities(db: SupabaseClient): Promise<Locality[]> {
  const { data, error } = await db.from("localities").select("*").order("name");
  if (error) throw fromPostgrest(error, "listAllLocalities");
  return z.array(localitySchema).parse(data);
}
/** New categories need no code: the template drives how their shops are presented (docs/adr/ADR-009). */
export async function createCategory(db: SupabaseClient, raw: unknown): Promise<void> {
  const i = categoryCreateInput.parse(raw);
  const slug = i.slug ?? slugify(i.name);
  if (!slug) throw new Error("Could not make a web address from that name");
  const { error } = await db.from("categories").insert({ name: i.name, slug, default_template: i.default_template, display_order: i.display_order });
  if (error) throw fromPostgrest(error, "createCategory");
}
export async function updateCategory(db: SupabaseClient, id: string, raw: unknown): Promise<void> {
  const patch = categoryUpdateInput.parse(raw);
  if (Object.keys(patch).length === 0) return;
  const { error } = await db.from("categories").update(patch).eq("id", z.uuid().parse(id));
  if (error) throw fromPostgrest(error, "updateCategory");
}
export async function createLocality(db: SupabaseClient, raw: unknown): Promise<void> {
  const i = localityCreateInput.parse(raw);
  const { error } = await db.from("localities").insert({ name: i.name, slug: i.slug ?? slugify(i.name), district: i.district, state: "Telangana", pincode: i.pincode });
  if (error) throw fromPostgrest(error, "createLocality");
}
export async function updateLocality(db: SupabaseClient, id: string, raw: unknown): Promise<void> {
  const patch = localityUpdateInput.parse(raw);
  if (Object.keys(patch).length === 0) return;
  const { error } = await db.from("localities").update(patch).eq("id", z.uuid().parse(id));
  if (error) throw fromPostgrest(error, "updateLocality");
}