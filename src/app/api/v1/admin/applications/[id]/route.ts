import { requireApiAdmin } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok } from "@/server/http";
import { getApplicationForAdmin } from "@/server/services";
import { uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/admin/applications/:id — details, history and duplicate warnings (admin only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const detail = await getApplicationForAdmin(guard.caller.db, uuidSchema.parse(id));
    return detail ? ok(detail) : errorResponse("NOT_FOUND", "Application not found");
  } catch (e) {
    return handleRouteError(e);
  }
}
