import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { categoryCreateInput, categorySchema, categoryUpdateInput, localityCreateInput, localitySchema, localityUpdateInput, slugify, type Category, type Locality } from "../validation";
import { fromPostgrest } from "./service-result";

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