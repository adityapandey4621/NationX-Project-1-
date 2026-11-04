import { requireApiStaff } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { setWaitlistStatus } from "@/server/services";
import { uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** PATCH /api/v1/admin/waitlist/:id — body { status: waiting|contacted }. Staff only; audited; idempotent. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiStaff(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    return ok({ id, changed: await setWaitlistStatus(guard.caller.db, uuidSchema.parse(id), await readJson(request)) });
  } catch (e) {
    return handleRouteError(e);
  }
}