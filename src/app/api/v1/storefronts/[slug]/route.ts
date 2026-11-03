import { errorResponse, handleRouteError, ok } from "@/server/http";
import { publicClient } from "@/server/auth/request";
import { getPublicStorefront, listPublicProducts } from "@/server/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/storefronts/:slug — public. Unpublished/hidden/suspended storefronts are 404. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const { slug } = await params;
    const storefront = await getPublicStorefront(client.db, slug);
    if (!storefront) return errorResponse("NOT_FOUND", "Storefront not found");
    const { shop, ...rest } = storefront;
    // Published items only; an empty list means the shop has not listed any (never an error).
    const products = await listPublicProducts(client.db, shop.id);
    return ok({ storefront: rest, shop, products });
  } catch (e) {
    return handleRouteError(e);
  }
}
