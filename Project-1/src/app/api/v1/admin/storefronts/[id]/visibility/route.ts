import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { setStorefrontVisibility } from "@/server/services";
import { uuidSchema, visibilityInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/storefronts/:id/visibility — body: { status: visible|hidden|suspended, reason }.
 * Admin only (re-checked in SQL). `reason` is mandatory for hidden/suspended. Idempotent; audited.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const input = visibilityInput.parse(await readJson(request));
    const result = await setStorefrontVisibility(guard.caller.db, uuidSchema.parse(id), input);
    return ok({ storefront_id: id, ...result });
  } catch (e) {
    return handleRouteError(e);
  }
}
