import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { joinWaitlist } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/waitlist — body { locality_id, category_id?, contact_phone (+91...), contact_name?, consent_given: true }.
 * Public. Asks to be contacted when shops open in an area; nothing is sent automatically, staff follow up by hand.
 * Idempotent: joining twice returns `already_waiting`.
 */
export async function POST(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    return ok({ status: await joinWaitlist(client.db, await readJson(request)) });
  } catch (e) {
    return handleRouteError(e);
  }
}