import { requireApiUser } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { cancelMyHelpRequest } from "@/server/services";
import { uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** POST /api/v1/help-me-find-it/:id/cancel — the owner withdraws an open request. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    await cancelMyHelpRequest(guard.caller.db, uuidSchema.parse(id));
    return ok({ request_id: id, status: "cancelled" });
  } catch (e) {
    return handleRouteError(e);
  }
}
