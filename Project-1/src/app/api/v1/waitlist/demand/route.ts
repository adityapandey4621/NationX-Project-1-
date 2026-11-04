import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { DEMAND_DISPLAY_MIN, listWaitlistDemand, visibleDemand } from "@/server/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/waitlist/demand — public. People waiting per area, only where at least 3 are (small numbers are not shown). */
export async function GET(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    return ok({ minimum_shown: DEMAND_DISPLAY_MIN, areas: visibleDemand(await listWaitlistDemand(client.db)) });
  } catch (e) {
    return handleRouteError(e);
  }
}