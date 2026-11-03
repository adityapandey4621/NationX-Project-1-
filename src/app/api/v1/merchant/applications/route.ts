import { requireApiUser } from "@/server/auth/request";
import { handleRouteError, ok, readJson } from "@/server/http";
import {
  createApplicationDraft,
  listMyApplications,
  submitApplication,
  updateApplicationDraft,
} from "@/server/services";
import { saveApplicationDraftInput, submitApplicationInput, uuidSchema } from "@/server/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

/** GET /api/v1/merchant/applications — the caller's own applications. */
export async function GET(request: Request) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    return ok({ applications: await listMyApplications(guard.caller.db, guard.caller.userId) });
  } catch (e) {
    return handleRouteError(e);
  }
}

const envelope = z.object({
  action: z.enum(["save_draft", "submit"]),
  application_id: uuidSchema.optional(),
});

/**
 * POST /api/v1/merchant/applications — create/update a draft or submit.
 * Body: { action, application_id?, ...application fields (snake_case) }.
 * Submit validates the complete field set (incl. declaration) before the
 * database workflow function performs the transition.
 */
export async function POST(request: Request) {
  try {
    const guard = await requireApiUser(request);
    if ("response" in guard) return guard.response;
    const { db, userId } = guard.caller;

    const body = await readJson(request);
    const { action, application_id } = envelope.parse(body);

    const fields =
      action === "submit"
        ? submitApplicationInput.parse(body)
        : saveApplicationDraftInput.parse(body);
    const draft = application_id
      ? await updateApplicationDraft(db, userId, application_id, fields)
      : await createApplicationDraft(db, userId, fields);

    if (action === "submit") {
      await submitApplication(db, draft.id);
      return ok(
        { application_id: draft.id, status: "submitted", message: "Your shop application has been submitted for verification." },
        201,
      );
    }
    return ok({ application_id: draft.id, status: draft.status, message: "Draft saved." }, application_id ? 200 : 201);
  } catch (e) {
    return handleRouteError(e);
  }
}
