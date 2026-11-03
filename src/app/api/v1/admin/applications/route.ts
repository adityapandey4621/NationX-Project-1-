import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { listApplicationsForAdmin } from "@/server/services";
import { applicationStatusSchema } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const query = z.object({
  status: applicationStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** GET /api/v1/admin/applications?status=submitted — review queue (admin only). */
export async function GET(request: Request) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const params = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    return ok({ applications: await listApplicationsForAdmin(guard.caller.db, params) });
  } catch (e) {
    return handleRouteError(e);
  }
}
