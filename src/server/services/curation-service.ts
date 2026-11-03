import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { bannerInput, bannerSchema, featuredInput, featuredRowSchema, type Banner, type FeaturedRow, type SearchResult } from "../validation";
import { searchStorefronts } from "./discovery-service";
import { fromPostgrest } from "./service-result";

/** Banners an admin set live (the database hides inactive and out-of-window ones from the public). May be empty. */
export async function listActiveBanners(db: SupabaseClient, localityId: string | null): Promise<Banner[]> {
  const { data, error } = await db.from("homepage_banners").select("id, title, body, link_url, locality_id, display_order, is_active, starts_at, ends_at").order("display_order").limit(20);
  if (error) throw fromPostgrest(error, "listActiveBanners");
  return z.array(bannerSchema).parse(data).filter((b) => b.locality_id === null || b.locality_id === localityId).slice(0, 4);
}

/** Featured shops, in the admin's order, only while they are still live. May be empty: nothing is featured by default. */
export async function listFeaturedShops(db: SupabaseClient, localityId: string | null, limit = 4): Promise<SearchResult[]> {
  const { data, error } = await db.from("featured_storefronts").select("id, storefront_id, locality_id, position").order("position").limit(50);
  if (error) throw fromPostgrest(error, "listFeaturedShops");
  const rows = z.array(featuredRowSchema).parse(data).filter((r) => r.locality_id === null || r.locality_id === localityId);
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.storefront_id))].slice(0, 24);
  const page = await searchStorefronts(db, { ids, limit: ids.length, sort: "newest" });
  const byId = new Map(page.results.map((s) => [s.storefront_id, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is SearchResult => s !== undefined).slice(0, limit);
}

// ---- admin (row-level security requires the admin role; re-checked here by the caller) ----
export async function listBannersForAdmin(db: SupabaseClient): Promise<Banner[]> {
  const { data, error } = await db.from("homepage_banners").select("id, title, body, link_url, locality_id, display_order, is_active, starts_at, ends_at").order("display_order");
  if (error) throw fromPostgrest(error, "listBannersForAdmin");
  return z.array(bannerSchema).parse(data);
}
export async function createBanner(db: SupabaseClient, raw: unknown): Promise<void> {
  const i = bannerInput.parse(raw);
  const { error } = await db.from("homepage_banners").insert({ title: i.title, body: i.body ?? null, link_url: i.link_url ?? null, locality_id: i.locality_id ?? null, display_order: i.display_order });
  if (error) throw fromPostgrest(error, "createBanner");
}
export async function setBannerActive(db: SupabaseClient, id: string, active: boolean): Promise<void> {
  const { error } = await db.from("homepage_banners").update({ is_active: active }).eq("id", z.uuid().parse(id));
  if (error) throw fromPostgrest(error, "setBannerActive");
}
export async function deleteBanner(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("homepage_banners").delete().eq("id", z.uuid().parse(id));
  if (error) throw fromPostgrest(error, "deleteBanner");
}
export async function listFeaturedForAdmin(db: SupabaseClient): Promise<FeaturedRow[]> {
  const { data, error } = await db.from("featured_storefronts").select("id, storefront_id, locality_id, position").order("position");
  if (error) throw fromPostgrest(error, "listFeaturedForAdmin");
  return z.array(featuredRowSchema).parse(data);
}
export async function addFeatured(db: SupabaseClient, raw: unknown): Promise<void> {
  const i = featuredInput.parse(raw);
  const { error } = await db.from("featured_storefronts").insert({ storefront_id: i.storefront_id, locality_id: i.locality_id ?? null, position: i.position });
  if (error) throw fromPostgrest(error, "addFeatured");
}
export async function removeFeatured(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("featured_storefronts").delete().eq("id", z.uuid().parse(id));
  if (error) throw fromPostgrest(error, "removeFeatured");
}