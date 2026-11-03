import { requireApiUser } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok } from "@/server/http";
import {
  listShopProducts,
  MAX_IMAGE_BYTES,
  removeStorefrontImage,
  requireShopAccess,
  ServiceError,
  setProductImage,
  uploadStorefrontImage,
} from "@/server/services";
import { uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ shopId: string; productId: string }> };

/**
 * POST /api/v1/merchant/shops/:shopId/products/:productId/image — multipart form with a `file` field.
 * Owner/manager only. The type is verified from the file's leading bytes (the declared MIME type is
 * never trusted), size is capped at 5 MB, and Storage RLS independently restricts writes to the shop's folder.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const { shopId, productId } = await params;
    const shop = await requireShopAccess(db, userId, shopId, "manage");
    const pid = uuidSchema.parse(productId);

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return errorResponse("VALIDATION_FAILED", "Attach an image in the `file` field");
    }
    if (file.size > MAX_IMAGE_BYTES) return errorResponse("VALIDATION_FAILED", "Image is too large (maximum 5 MB)");

    const existing = (await listShopProducts(db, shop.id)).find((p) => p.id === pid);
    if (!existing) throw new ServiceError("NOT_FOUND", "Item not found");
    const { url } = await uploadStorefrontImage(db, shop.id, "product", new Uint8Array(await file.arrayBuffer()));
    await setProductImage(db, shop.id, pid, url);
    if (existing.image_url) await removeStorefrontImage(db, shop.id, existing.image_url);
    return ok({ product_id: pid, image_url: url });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** DELETE /api/v1/merchant/shops/:shopId/products/:productId/image — removes the item's photo. */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    const { shopId, productId } = await params;
    const shop = await requireShopAccess(db, userId, shopId, "manage");
    const pid = uuidSchema.parse(productId);
    const existing = (await listShopProducts(db, shop.id)).find((p) => p.id === pid);
    if (!existing) throw new ServiceError("NOT_FOUND", "Item not found");
    await setProductImage(db, shop.id, pid, null);
    if (existing.image_url) await removeStorefrontImage(db, shop.id, existing.image_url);
    return ok({ product_id: pid, image_url: null });
  } catch (e) {
    return handleRouteError(e);
  }
}
