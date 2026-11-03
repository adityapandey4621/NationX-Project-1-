import { requireApiStaff } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { listWaitlistForStaff } from "@/server/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/admin/waitlist?status=waiting|contacted — admins and operators. Includes phone numbers: handle accordingly. */
export async function GET(request: Request) {
  try {
    const guard = await requireApiStaff(request);
    if ("response" in guard) return guard.response;
    const s = new URL(request.url).searchParams.get("status");
    const entries = await listWaitlistForStaff(guard.caller.db, { status: s === "waiting" || s === "contacted" ? s : undefined });
    return ok({ entries });
  } catch (e) {
    return handleRouteError(e);
  }
}