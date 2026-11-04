import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok } from "@/server/http";
import { listStorefrontsForAdmin } from "@/server/services";
import { visibilityStatusSchema } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const query = z.object({
  q: z.string().trim().max(80).optional(),
  status: visibilityStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

/** GET /api/v1/admin/storefronts?q=&status=&limit=&offset= — every storefront with its moderation state. Admin only. */
export async function GET(request: Request) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const p = new URL(request.url).searchParams;
    const input = query.parse({
      q: p.get("q") || undefined,
      status: p.get("status") || undefined,
      limit: p.get("limit") ?? undefined,
      offset: p.get("offset") ?? undefined,
    });
    const { rows, total } = await listStorefrontsForAdmin(guard.caller.db, input);
    return ok({ total, limit: input.limit, offset: input.offset, storefronts: rows });
  } catch (e) {
    return handleRouteError(e);
  }
}
