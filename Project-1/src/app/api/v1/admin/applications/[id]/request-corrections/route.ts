import { requireApiAdmin } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import { requestApplicationCorrections } from "@/server/services";
import { requestCorrectionsInput, uuidSchema } from "@/server/validation";

export const dynamic = "force-dynamic";

/** POST /api/v1/admin/applications/:id/request-corrections — body: { notes } (mandatory). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireApiAdmin(request);
    if ("response" in guard) return guard.response;
    const { id } = await params;
    const { notes } = requestCorrectionsInput.parse(await readJson(request));
    await requestApplicationCorrections(guard.caller.db, uuidSchema.parse(id), notes);
    return ok({ application_id: id, status: "correction_requested" });
  } catch (e) {
    return handleRouteError(e);
  }
}
