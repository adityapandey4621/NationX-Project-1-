import { authenticateApiRequest } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok, readJson } from "@/server/http";
import { getProfile, updateOwnProfile } from "@/server/services";
import { updateProfileInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/me — the caller's own profile and roles. */
export async function GET(request: Request) {
  try {
    const caller = await authenticateApiRequest(request);
    if (!caller) return errorResponse("UNAUTHENTICATED", "Authentication required");
    const profile = await getProfile(caller.db, caller.userId);
    return ok({ profile, roles: caller.roles });
  } catch (e) {
    return handleRouteError(e);
  }
}

/** PATCH /api/v1/me — update own name, phone or language. Cannot touch roles. */
export async function PATCH(request: Request) {
  try {
    const caller = await authenticateApiRequest(request);
    if (!caller) return errorResponse("UNAUTHENTICATED", "Authentication required");
    const input = updateProfileInput.parse(await readJson(request));
    const profile = await updateOwnProfile(caller.db, caller.userId, input);
    return ok({ profile });
  } catch (e) {
    return handleRouteError(e);
  }
}
