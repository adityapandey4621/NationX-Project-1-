import { publicClient } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { listActiveCategories, listActiveLocalities } from "@/server/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/taxonomy — active localities and categories (public). */
export async function GET(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const [localities, categories] = await Promise.all([
      listActiveLocalities(client.db),
      listActiveCategories(client.db),
    ]);
    return ok({ localities, categories });
  } catch (e) {
    return handleRouteError(e);
  }
}
