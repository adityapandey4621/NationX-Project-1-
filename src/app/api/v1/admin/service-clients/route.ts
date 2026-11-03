import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { createServiceClient, listServiceClients } from "@/server/services";

export const dynamic = "force-dynamic";

/** GET /api/v1/admin/service-clients — admin only. Lists integration clients (never keys or hashes). */
export async function GET(request: Request) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    return ok({ clients: await listServiceClients(guard.caller.db) });
  } catch (e) {
    return handleRouteError(e);
  }
}

/**
 * POST /api/v1/admin/service-clients — body { name, scopes[] }. Admin only; audited.
 * The response contains the key exactly once (`key`); only its hash is stored, so it cannot be shown again.
 */
export async function POST(request: Request) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const { client, key } = await createServiceClient(guard.caller.db, await readJson(request));
    const res = ok({ client, key }, 201);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}