import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { getHomepageData, toApiShop } from "@/server/services";
import { uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/discovery/homepage?localityId= — categories, localities, newest published shops, active modules (public). */
export async function GET(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const raw = new URL(request.url).searchParams.get("localityId");
    const localityId = raw ? uuidSchema.parse(raw) : null;
    const data = await getHomepageData(client.db, localityId);
    return ok({
      categories: data.categories,
      localities: data.localities,
      featured_shops: data.recent.results.map(toApiShop),
      // Additive (ADR-009): newest published items; empty until shops list some.
      recent_items: data.items,
      // Additive (migration 010): real per-area counts of live shops.
      community: data.community,
      active_modules: data.modules,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
