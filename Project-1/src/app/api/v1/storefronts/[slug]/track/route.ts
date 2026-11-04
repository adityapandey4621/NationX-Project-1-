import { handleRouteError, ok, readJson } from "@/server/http";
import { publicClient } from "@/server/auth/request";
import { recordStorefrontEvent } from "@/server/services";
import { trackSlug } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/storefronts/:slug/track — body { action: view|call|whatsapp|directions }. Public.
 * Adds one to that day's counter for a live storefront. Records no visitor identifier. Always
 * answers the same way whether or not the slug exists, so it cannot be used to probe slugs.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const client = await publicClient(request);
    if ("response" in client) return client.response;
    const slug = trackSlug.safeParse((await params).slug);
    const body = await readJson(request);
    if (slug.success) await recordStorefrontEvent(client.db, slug.data, body);
    return ok({ recorded: true });
  } catch (e) {
    return handleRouteError(e);
  }
}