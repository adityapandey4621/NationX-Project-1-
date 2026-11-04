import { publicClient } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok, readJson } from "@/server/http";
import { ServiceError, trackHelpRequest } from "@/server/services";
import { trackHelpRequestInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/** POST /api/v1/help-me-find-it/track — body { tracking_id, contact_phone }; both must match. */
export async function POST(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const input = trackHelpRequestInput.parse(await readJson(request));
    return ok(await trackHelpRequest(client.db, input));
  } catch (e) {
    // Same answer whether the id or the phone was wrong.
    if (e instanceof ServiceError && e.code === "NOT_FOUND") {
      return errorResponse("NOT_FOUND", "No request matches that tracking ID and phone number");
    }
    return handleRouteError(e);
  }
}
