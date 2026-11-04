import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { leaveWaitlist } from "@/server/services";

export const dynamic = "force-dynamic";

/** POST /api/v1/waitlist/leave — body { locality_id, contact_phone }. Withdraws consent and deletes the entry. Same answer whether or not one existed. */
export async function POST(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    await leaveWaitlist(client.db, await readJson(request));
    return ok({ removed: true });
  } catch (e) {
    return handleRouteError(e);
  }
}