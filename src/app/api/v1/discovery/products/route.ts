import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { searchProducts, toApiProduct } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/discovery/products?q=&categoryId=&localityId=&sort=&limit=&offset=
 * Public. Items listed by published shops only; `q` is required. The availability
 * label is the effective one: stale or unconfirmed stock reads `call_to_confirm`.
 */
export async function GET(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const p = new URL(request.url).searchParams;
    const page = await searchProducts(client.db, {
      q: p.get("q") ?? "",
      category_id: p.get("categoryId") ?? undefined,
      locality_id: p.get("localityId") ?? undefined,
      sort: p.get("sort") ?? undefined,
      limit: p.get("limit") ?? undefined,
      offset: p.get("offset") ?? undefined,
    });
    return ok({
      query: p.get("q") ?? "",
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      results: page.results.map((r) => ({ type: "product" as const, ...toApiProduct(r) })),
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
