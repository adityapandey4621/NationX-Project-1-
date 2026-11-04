import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { LOCALITY_COOKIE } from "@/lib/constants";
import { isSupabaseConfigured } from "@/server/config/env";
import { listCategoryCounts, listLocalityCounts } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import type { CategoryCount, LocalityCount } from "@/server/validation";

export interface ChromeData {
  categories: CategoryCount[];
  localities: LocalityCount[];
  /** The visitor's remembered area (cookie), when it is still an active locality. */
  locality: LocalityCount | null;
}

const EMPTY: ChromeData = { categories: [], localities: [], locality: null };

/**
 * Data shared by the header and footer (areas, categories, remembered area).
 * Memoised per request. A failure degrades to empty lists: the chrome must never
 * take a page down.
 */
export const loadChrome = cache(async (): Promise<ChromeData> => {
  if (!isSupabaseConfigured()) return EMPTY;
  try {
    const db = await createRequestClient();
    const [categories, localities] = await Promise.all([listCategoryCounts(db), listLocalityCounts(db)]);
    const slug = (await cookies()).get(LOCALITY_COOKIE)?.value;
    return { categories, localities, locality: localities.find((l) => l.slug === slug) ?? null };
  } catch (e) {
    unstable_rethrow(e); // Next control-flow errors (e.g. dynamic rendering) must not be swallowed
    console.error("Site chrome failed to load", e);
    return EMPTY;
  }
});
