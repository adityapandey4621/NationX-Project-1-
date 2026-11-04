import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { getSuggestions } from "@/server/services";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/discovery/suggest?q= — typeahead for the search box (public).
 * Real shop names plus categories and areas whose name contains the text.
 * Fewer than two characters returns empty lists. No history is stored.
 */
export async function GET(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return ok(await getSuggestions(client.db, q));
  } catch (e) {
    return handleRouteError(e);
  }
}
