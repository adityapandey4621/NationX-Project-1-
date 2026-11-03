import { requireApiUser } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { listMyBusinesses } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/merchant/shops — businesses (and their shops + storefronts) the caller belongs to,
 * with the caller's role in each. Membership is enforced by RLS; an applicant with no approved shop gets an empty list.
 */
export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;
    return ok({ businesses: await listMyBusinesses(db, userId) });
  } catch (e) {
    return handleRouteError(e);
  }
}
