import { authenticateApiRequest, publicClient } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok, readJson } from "@/server/http";
import { listMyHelpRequests, submitHelpRequest } from "@/server/services";
import { submitHelpRequestInput } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/help-me-find-it — public (anonymous or signed in; a bearer token attaches the account).
 * Returns the tracking id. The database validates, throttles (429) and numbers the request.
 */
export async function POST(request: Request) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const input = submitHelpRequestInput.parse(await readJson(request));
    const result = await submitHelpRequest(client.db, input);
    return ok(
      {
        tracking_id: result.tracking_id,
        status: result.status,
        message: "Your request has been received. Our local team will look for a shop and update you.",
      },
      201,
    );
  } catch (e) {
    return handleRouteError(e);
  }
}

/** GET /api/v1/help-me-find-it — the signed-in caller's own requests only. */
export async function GET(request: Request) {
  try {
    const caller = await authenticateApiRequest(request);
    if (!caller) return errorResponse("UNAUTHENTICATED", "Authentication required");
    return ok({ requests: await listMyHelpRequests(caller.db, caller.userId) });
  } catch (e) {
    return handleRouteError(e);
  }
}
