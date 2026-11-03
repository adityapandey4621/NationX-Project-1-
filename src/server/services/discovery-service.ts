import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  categoryCountSchema,
  communityStatSchema,
  featureFlagSchema,
  localityCountSchema,
  recentProductSchema,
  searchInput,
  searchResultSchema,
  type CategoryCount,
  type CommunityStat,
  type FeatureFlag,
  type LocalityCount,
  type RecentProduct,
  type SearchInput,
  type SearchResult,
} from "../validation";
import { fromPostgrest } from "./service-result";

export interface SearchPage {
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Search published storefronts. All matching, ranking and the published-only
 * rule live in the database function `search_storefronts` (migration 006); this
 * wrapper validates input and shapes the page. Results are real records only.
 */
export async function searchStorefronts(db: SupabaseClient, raw: unknown = {}): Promise<SearchPage> {
  const input: SearchInput = searchInput.parse(raw);
  const { data, error } = await db.rpc("search_storefronts", {
    p_query: input.q ?? null,
    p_category_id: input.category_id ?? null,
    p_locality_id: input.locality_id ?? null,
    p_model: input.model ?? null,
    p_sort: input.sort,
    p_limit: input.limit,
    p_offset: input.offset,
    // Both or neither: half a position is meaningless.
    p_lat: input.lat !== undefined && input.lng !== undefined ? input.lat : null,
    p_lng: input.lat !== undefined && input.lng !== undefined ? input.lng : null,
    p_ids: input.ids ?? null,
  });
  if (error) throw fromPostgrest(error, "searchStorefronts");
  const results = z.array(searchResultSchema).parse(data);
  return { results, total: results[0]?.total_count ?? 0, limit: input.limit, offset: input.offset };
}

/** A result as exposed over the API: the page-level `total_count` is reported once, not per row. */
export function toApiShop(result: SearchResult) {
  const { total_count, ...shop } = result;
  void total_count;
  return shop;
}

export async function listCategoryCounts(db: SupabaseClient): Promise<CategoryCount[]> {
  const { data, error } = await db.rpc("public_category_counts");
  if (error) throw fromPostgrest(error, "listCategoryCounts");
  return z.array(categoryCountSchema).parse(data);
}

export async function listLocalityCounts(db: SupabaseClient): Promise<LocalityCount[]> {
  const { data, error } = await db.rpc("public_locality_counts");
  if (error) throw fromPostgrest(error, "listLocalityCounts");
  return z.array(localityCountSchema).parse(data);
}

/**
 * A module (e.g. grocery, shared delivery) counts as active only if its flag is
 * enabled and either has no locality restriction or includes the customer's
 * locality (REQ-HOM-05 / REQ-HOM-08: never show a module as operational otherwise).
 */
export function activeModules(flags: readonly FeatureFlag[], localityId: string | null): Record<string, boolean> {
  return Object.fromEntries(
    flags.map((f) => [
      f.key,
      f.is_enabled && (f.enabled_localities.length === 0 || (localityId !== null && f.enabled_localities.includes(localityId))),
    ]),
  );
}

export async function listFeatureFlags(db: SupabaseClient): Promise<FeatureFlag[]> {
  const { data, error } = await db.from("feature_flags").select("key, is_enabled, enabled_localities");
  if (error) throw fromPostgrest(error, "listFeatureFlags");
  return z.array(featureFlagSchema).parse(data);
}

/** Honest per-area counts (migration 010). Sample/dev listings are excluded in SQL. */
export async function listCommunityStats(db: SupabaseClient): Promise<CommunityStat[]> {
  const { data, error } = await db.rpc("community_stats");
  if (error) throw fromPostgrest(error, "listCommunityStats");
  return z.array(communityStatSchema).parse(data);
}

/** Newest published items from published shops (real listings only; may be empty). */
export async function listRecentProducts(db: SupabaseClient, localityId: string | null = null, limit = 8): Promise<RecentProduct[]> {
  const { data, error } = await db.rpc("recent_public_products", { p_locality_id: localityId, p_limit: limit });
  if (error) throw fromPostgrest(error, "listRecentProducts");
  return z.array(recentProductSchema).parse(data);
}

export interface HomepageData {
  categories: CategoryCount[];
  localities: LocalityCount[];
  /** Newest published shops (admin-curated featuring is not built yet). */
  recent: SearchPage;
  /** Newest published items; empty when no shop has listed any. Never required for the page to render. */
  items: RecentProduct[];
  /** Real per-area counts of live shops; empty if unavailable. */
  community: CommunityStat[];
  modules: Record<string, boolean>;
}

/** Everything the homepage shows, from real records; optionally scoped to one locality. */
export async function getHomepageData(db: SupabaseClient, localityId: string | null = null, shopLimit = 6): Promise<HomepageData> {
  const [categories, localities, recent, flags, items, community] = await Promise.all([

    listCategoryCounts(db),
    listLocalityCounts(db),
    searchStorefronts(db, { sort: "newest", limit: shopLimit, locality_id: localityId ?? undefined }),
    listFeatureFlags(db),
    // The item strip is a bonus: if it fails the rest of the homepage must still render.
    listRecentProducts(db, localityId, 8).catch((e: unknown) => {
      console.error("Recent items failed", e);
      return [] as RecentProduct[];
    }),
    // Bonus data: a failure must not take the homepage down.
    listCommunityStats(db).catch((e: unknown) => {
      console.error("Community stats failed", e);
      return [] as CommunityStat[];
    }),
  ]);
  return { categories, localities, recent, items, community, modules: activeModules(flags, localityId) };
}

export interface Suggestions {
  shops: { name: string; slug: string; category: string; locality: string }[];
  categories: { name: string; slug: string }[];
  localities: { name: string; slug: string }[];
}

/**
 * Typeahead suggestions for the search box: real shop names (via the same search
 * function as the results page), plus categories and areas whose name contains the
 * text. Nothing here is invented, and there is no per-user history.
 */
export async function getSuggestions(db: SupabaseClient, rawQuery: string): Promise<Suggestions> {
  const q = searchInput.parse({ q: rawQuery }).q;
  if (!q || q.length < 2) return { shops: [], categories: [], localities: [] };
  const needle = q.toLowerCase();
  const [page, categories, localities] = await Promise.all([
    searchStorefronts(db, { q, limit: 5 }),
    listCategoryCounts(db),
    listLocalityCounts(db),
  ]);
  return {
    shops: page.results.map((r) => ({ name: r.shop_name, slug: r.slug, category: r.category_name, locality: r.locality_name })),
    categories: categories.filter((c) => c.name.toLowerCase().includes(needle)).slice(0, 3).map((c) => ({ name: c.name, slug: c.slug })),
    localities: localities.filter((l) => l.name.toLowerCase().includes(needle)).slice(0, 3).map((l) => ({ name: l.name, slug: l.slug })),
  };
}
