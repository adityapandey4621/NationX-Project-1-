import { requireApiUser } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { createProduct, listShopProducts, requireShopAccess } from "@/server/services";
import { createProductInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/merchant/shops/:shopId/products — every item of a shop the caller belongs to (owner, manager or employee). */
export async function GET(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const shop = await requireShopAccess(db, userId, (await params).shopId, "read");
    return ok({ products: await listShopProducts(db, shop.id) });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** POST /api/v1/merchant/shops/:shopId/products — owner/manager only. Stock defaults to `call_to_confirm`. */
export async function POST(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const input = createProductInput.parse(await readJson(request));
    const shop = await requireShopAccess(db, userId, (await params).shopId, "manage");
    const { id } = await createProduct(db, shop.id, input);
    return ok({ product_id: id }, 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
