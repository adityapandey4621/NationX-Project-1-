import { requireServiceScope } from "@/server/auth/service-auth";
import { handleRouteError, ok } from "@/server/http";
import { listShopReferences } from "@/server/services";
import { shopsQuery } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/integration/shops?after=<shopId>&limit=<1-200>&locality=<slug> — scope reference:read.
 * Live shops only (published, visible, active, never development samples), ordered by shop id,
 * with the references other products need (contract C1): ids, category, locality, address, coordinates,
 * public phone/WhatsApp, operating models and hours.
 */
export async function GET(request: Request) {
  try {
    const guard = await requireServiceScope(request, "reference:read");
    if ("response" in guard) return guard.response;
    const q = shopsQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return ok(await listShopReferences(guard.adminDb, q));
  } catch (e) {
    return handleRouteError(e);
  }
}