import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { searchStorefronts, toApiShop } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/discovery/search?q=&categoryId=&localityId=&model=&sort=&limit=&offset=&lat=&lng= (sort=nearest needs lat+lng; coordinates are not stored)
 * Public. Returns real, published shops only (products arrive with the catalogue phase).
 */
export async function GET(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const p = new URL(request.url).searchParams;
    const page = await searchStorefronts(client.db, {
      q: p.get("q") ?? undefined,
      category_id: p.get("categoryId") ?? undefined,
      locality_id: p.get("localityId") ?? undefined,
      model: p.get("model") ?? undefined,
      sort: p.get("sort") ?? undefined,
      limit: p.get("limit") ?? undefined,
      offset: p.get("offset") ?? undefined,
      lat: p.get("lat") ?? undefined,
      lng: p.get("lng") ?? undefined,
    });
    return ok({
      query: p.get("q") ?? "",
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      results: page.results.map((r) => ({ type: "shop" as const, ...toApiShop(r) })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
