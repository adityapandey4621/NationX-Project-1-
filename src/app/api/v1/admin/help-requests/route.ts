import { requireApiStaff } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { listHelpRequestsForStaff } from "@/server/services";
import { hmfStatusSchema } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const query = z.object({
  status: hmfStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** GET /api/v1/admin/help-requests?status= — triage queue (admin / operator). */
export async function GET(request: Request) {
  try {
    const guard = await requireApiStaff(request);
    if ("response" in guard) return guard.response;
    const params = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    return ok({ requests: await listHelpRequestsForStaff(guard.caller.db, params) });
  } catch (e) {
    return handleRouteError(e);
  }
}
