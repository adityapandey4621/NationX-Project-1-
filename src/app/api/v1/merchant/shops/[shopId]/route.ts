import { requireApiUser } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { requireShopAccess, updateShopDetails } from "@/server/services";
import { updateShopDetailsInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/merchant/shops/:shopId — one shop the caller belongs to (404 otherwise). */
export async function GET(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    return ok({ shop: await requireShopAccess(db, userId, (await params).shopId, "read") });
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * PATCH /api/v1/merchant/shops/:shopId — owner/manager only. Same permitted fields as the web workspace
 * (phone, whatsapp, address, landmark, pincode, coordinates, hours, operating models, headline, description).
 * Name, category, locality, slug, publication and ordering are not editable (re-verification / admin only).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const input = updateShopDetailsInput.parse(await readJson(request));
    const shop = await requireShopAccess(db, userId, (await params).shopId, "manage");
    await updateShopDetails(db, shop.id, input);
    return ok({ shop_id: shop.id });
  } catch (e) {
    return handleRouteError(e);
  }
}
