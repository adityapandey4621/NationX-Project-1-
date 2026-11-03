import type { CommunityStat } from "@/server/validation";

export interface CommunitySummary {
  totalShops: number;
  joined30d: number;
  /** Areas where at least one shop joined recently, newest activity first. */
  recentAreas: { name: string; slug: string; joined: number }[];
  /** Active areas with no live shop yet (an honest "be the first" prompt, not a claim). */
  emptyAreas: { name: string; slug: string }[];
}

/**
 * Turns the database's real per-area counts into display facts. It only ever reports
 * what was counted: no multipliers, no rounding up, no "trending". Callers decide how
 * small a number is worth showing (see `worthShowing`).
 */
export function summarizeCommunity(stats: readonly CommunityStat[]): CommunitySummary {
  const totalShops = stats.reduce((n, s) => n + s.shop_count, 0);
  const joined30d = stats.reduce((n, s) => n + s.joined_30d, 0);
  const recentAreas = stats
    .filter((s) => s.joined_30d > 0)
    .sort((a, b) => (b.last_joined_at ?? "").localeCompare(a.last_joined_at ?? ""))
    .map((s) => ({ name: s.locality_name, slug: s.locality_slug, joined: s.joined_30d }));
  const emptyAreas = stats.filter((s) => s.shop_count === 0).map((s) => ({ name: s.locality_name, slug: s.locality_slug }));
  return { totalShops, joined30d, recentAreas, emptyAreas };
}

/** "1 shop" / "12 shops". */
export function shopsLabel(n: number): string {
  return `${n} ${n === 1 ? "shop" : "shops"}`;
}