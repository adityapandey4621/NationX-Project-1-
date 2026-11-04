import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { statsRowSchema, trackInput, type StatsRow } from "../validation";
import { fromPostgrest } from "./service-result";

/** Records one view or tap. A slug that is not a live storefront is a silent no-op (returns false). */
export async function recordStorefrontEvent(db: SupabaseClient, slug: string, raw: unknown): Promise<boolean> {
  const { action } = trackInput.parse(raw);
  const { data, error } = await db.rpc("record_storefront_event", { p_slug: slug, p_action: action });
  if (error) throw fromPostgrest(error, "recordStorefrontEvent");
  return data === true;
}

export interface StatsSummary {
  days: number;
  views: number;
  calls: number;
  whatsapp: number;
  directions: number;
  /** Taps on Call, WhatsApp and Directions together. */
  taps: number;
}

/** Totals for the last `days` days (IST) for one shop. RLS limits this to the shop's team and admins. */
export function summarizeStats(rows: readonly StatsRow[], days: number): StatsSummary {
  const sum = (k: "views" | "calls" | "whatsapp" | "directions") => rows.reduce((n, r) => n + r[k], 0);
  const calls = sum("calls");
  const whatsapp = sum("whatsapp");
  const directions = sum("directions");
  return { days, views: sum("views"), calls, whatsapp, directions, taps: calls + whatsapp + directions };
}

export async function getShopStats(db: SupabaseClient, shopId: string, days = 30): Promise<StatsSummary> {
  const since = new Date(Date.now() - (days - 1) * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const { data, error } = await db.from("storefront_stats_daily").select("day, views, calls, whatsapp, directions").eq("shop_id", shopId).gte("day", since);
  if (error) throw fromPostgrest(error, "getShopStats");
  return summarizeStats(z.array(statsRowSchema).parse(data), days);
}