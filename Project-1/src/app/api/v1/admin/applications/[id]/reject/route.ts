import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { rejectApplication } from "@/server/services";
import { rejectApplicationInput, uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** POST /api/v1/admin/applications/:id/reject — body: { reason } (mandatory). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const { reason } = rejectApplicationInput.parse(await readJson(request));
    await rejectApplication(guard.caller.db, uuidSchema.parse(id), reason);
    return ok({ application_id: id, status: "rejected" });
  } catch (e) {
    return handleRouteError(e);
  }
}
