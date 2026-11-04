import { requireServiceScope } from "@/server/auth/service-auth";
import { errorResponse, handleRouteError, ok } from "@/server/http";
import { getShopReference } from "@/server/services";
import { uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/integration/shops/:shopId — scope reference:read. 404 unless the shop is live. */
export async function GET(request: Request, { params }: { params: Promise<{ shopId: string }> }) {
  try {
    const guard = await requireServiceScope(request, "reference:read");
    if ("response" in guard) return guard.response;
    const shop = await getShopReference(guard.adminDb, uuidSchema.parse((await params).shopId));
    return shop ? ok(shop) : errorResponse("NOT_FOUND", "Shop not found");
  } catch (e) {
    return handleRouteError(e);
  }
}