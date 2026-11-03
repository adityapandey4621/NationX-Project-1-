import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { approveApplication } from "@/server/services";
import { approveApplicationInput, uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/applications/:id/approve — atomic, idempotent approval
 * that creates the business, owner membership, shop and published storefront.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const body = (await readJson(request)) ?? {};
    const result = await approveApplication(guard.caller.db, uuidSchema.parse(id), approveApplicationInput.parse(body));
    return ok({
      application_id: result.application_id,
      business_id: result.business_id,
      shop_id: result.shop_id,
      storefront: { id: result.storefront_id, slug: result.slug, path: `/shop/${result.slug}`, is_published: true },
      owner_assigned: result.owner_id,
      already_approved: result.already_approved,
    });
  } catch (e) {
    return handleRouteError(e);
  }
}
