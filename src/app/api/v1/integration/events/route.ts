import { requireServiceScope } from "@/server/auth/service-auth";
import { handleRouteError, ok } from "@/server/http";
import { listEvents } from "@/server/services";
import { eventsQuery } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/integration/events?after=<seq>&limit=<1-500> — scope events:read.
 * The change feed (contract C6). At-least-once and ordered by `seq`: store `next_cursor`
 * after you have processed a page, and make handlers idempotent on `event_id`.
 */
export async function GET(request: Request) {
  try {
    const guard = await requireServiceScope(request, "events:read");
    if ("response" in guard) return guard.response;
    const q = eventsQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
    return ok(await listEvents(guard.adminDb, q.after, q.limit));
  } catch (e) {
    return handleRouteError(e);
  }
}