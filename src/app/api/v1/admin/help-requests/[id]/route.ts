import { requireApiStaff } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok, readJson } from "@/server/http";
import { getHelpRequestForStaff, updateHelpRequest } from "@/server/services";
import { updateHelpRequestInput, uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/admin/help-requests/:id (admin / operator). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiStaff(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const found = await getHelpRequestForStaff(guard.caller.db, uuidSchema.parse(id));
    return found ? ok({ request: found }) : errorResponse("NOT_FOUND", "Request not found");
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * PATCH /api/v1/admin/help-requests/:id — body { status, notes?, matched_shop_slug? }.
 * No automatic matching: a person confirms a real, published shop.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiStaff(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const input = updateHelpRequestInput.parse(await readJson(request));
    await updateHelpRequest(guard.caller.db, uuidSchema.parse(id), input);
    return ok({ request_id: id, status: input.status });
  } catch (e) {
    return handleRouteError(e);
  }
}
