import { requireServiceScope } from "@/server/auth/service-auth";
import { handleRouteError, ok } from "@/server/http";
import { listFeatureFlags } from "@/server/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/integration/feature-flags — scope reference:read. Modules ship dark: check your flag before exposing anything. */
export async function GET(request: Request) {
  try {
    const guard = await requireServiceScope(request, "reference:read");
    if ("response" in guard) return guard.response;
    return ok({ flags: await listFeatureFlags(guard.adminDb) });
  } catch (e) {
    return handleRouteError(e);
  }
}