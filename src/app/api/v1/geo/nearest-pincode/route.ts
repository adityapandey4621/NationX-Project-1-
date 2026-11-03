import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { nearestPincodes } from "@/server/services";
import { nearestQueryInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/geo/nearest-pincode?lat=&lng= — PIN code suggestions for a shared GPS position (public, not stored). */
export async function GET(request: Request) {
  try {
    const { lat, lng } = nearestQueryInput.parse(Object.fromEntries(new URL(request.url).searchParams));
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    return ok({ suggestions: await nearestPincodes(client.db, lat, lng) });
  } catch (e) {
    return handleRouteError(e);
  }
}
