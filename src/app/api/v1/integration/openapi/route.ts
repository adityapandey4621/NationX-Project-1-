import { buildOpenApi } from "@/lib/openapi";
import { siteOrigin } from "@/server/site-origin";

export const dynamic = "force-dynamic";

/** GET /api/v1/integration/openapi — the OpenAPI 3.1 contract for the integration API. Public (it describes, it does not expose, data). */
export async function GET() {
  return Response.json(buildOpenApi(await siteOrigin()), { headers: { "Cache-Control": "public, max-age=300" } });
}