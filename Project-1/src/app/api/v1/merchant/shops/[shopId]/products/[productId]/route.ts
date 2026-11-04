import { requireApiUser } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { confirmProductStock, deleteProduct, requireShopAccess, updateProduct } from "@/server/services";
import { updateProductInput } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const confirmStockBody = z.object({ confirm_stock: z.literal(true) }).strict();

type Ctx = { params: Promise<{ shopId: string; productId: string }> };

/** PATCH /api/v1/merchant/shops/:shopId/products/:productId — owner/manager only; partial update. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const body = await readJson(request);
    const { shopId, productId } = await params;
    // { "confirm_stock": true } = "I re-checked the shelf": the database stamps the real time.
    if (confirmStockBody.safeParse(body).success) {
      const shop = await requireShopAccess(db, userId, shopId, "manage");
      await confirmProductStock(db, shop.id, productId);
      return ok({ product_id: productId, stock_confirmed: true });
    }
    const input = updateProductInput.parse(body);
    const shop = await requireShopAccess(db, userId, shopId, "manage");
    await updateProduct(db, shop.id, productId, input);
    return ok({ product_id: productId });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** DELETE /api/v1/merchant/shops/:shopId/products/:productId — owner/manager only. */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const { shopId, productId } = await params;
    const shop = await requireShopAccess(db, userId, shopId, "manage");
    await deleteProduct(db, shop.id, productId);
    return ok({ product_id: productId, deleted: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
