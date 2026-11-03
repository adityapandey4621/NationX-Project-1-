import { publicClient } from "@/server/auth/request";
import { errorResponse, handleRouteError, ok } from "@/server/http";
import { lookupPincode } from "@/server/services";
import { pincodeSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** GET /api/v1/geo/pincode/:pincode — district/state and matching localities (public). */
export async function GET(request: Request, { params }: { params: Promise<{ pincode: string }> }) {
  try {
    const { pincode } = await params;
    if (!pincodeSchema.safeParse(pincode).success) {
      return errorResponse("VALIDATION_FAILED", "Enter a valid 6-digit PIN code");
    }
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const result = await lookupPincode(client.db, pincode);
    return result ? ok(result) : errorResponse("NOT_FOUND", "We couldn't find that PIN code");
  } catch (e) {
    return handleRouteError(e);
  }
}
