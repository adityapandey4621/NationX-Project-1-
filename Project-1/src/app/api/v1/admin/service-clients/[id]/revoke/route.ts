import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { revokeServiceClient } from "@/server/services";
import { uuidSchema } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** POST /api/v1/admin/service-clients/:id/revoke — body { reason? }. Admin only; idempotent; audited. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(await readJson(request).catch(() => ({})));
    const { id } = await params;
    return ok({ client_id: id, ...(await revokeServiceClient(guard.caller.db, uuidSchema.parse(id), body.reason)) });
  } catch (e) {
    return handleRouteError(e);
  }
}