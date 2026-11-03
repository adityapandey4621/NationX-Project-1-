"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "../auth/actions";
import { requireUser } from "../auth/session";
import {
  attachApplicationFile,
  createApplicationDraft,
  deleteApplicationDraft,
  detachApplicationFile,
  PRIVATE_BUCKET,
  submitApplication,
  updateApplicationDraft,
  uploadApplicationFile,
  MAX_DOCUMENT_BYTES,
  ServiceError,
} from "../services";
import { createRequestClient } from "../supabase/server";
import {
  parseApplicationFormData,
  saveApplicationDraftInput,
  submitApplicationInput,
  uuidSchema,
} from "../validation";
import { actionError, field, zodState } from "./shared";

/** Create/update an application from the form, optionally submitting it for review. */
export async function saveApplicationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant/apply");
  const intent = field(formData, "intent") === "submit" ? "submit" : "save_draft";
  const applicationId = field(formData, "application_id");
  const raw = parseApplicationFormData(formData);

  const parsed =
    intent === "submit" ? submitApplicationInput.safeParse(raw) : saveApplicationDraftInput.safeParse(raw);
  if (!parsed.success) return zodState(parsed.error);

  const db = await createRequestClient();
  let applicationIdOut: string;
  try {
    const app = applicationId
      ? await updateApplicationDraft(db, ctx.user.id, uuidSchema.parse(applicationId), parsed.data)
      : await createApplicationDraft(db, ctx.user.id, parsed.data);
    applicationIdOut = app.id;
    if (intent === "submit") await submitApplication(db, app.id);
  } catch (e) {
    return actionError(e);
  }
  revalidatePath("/merchant");
  redirect(`/merchant/applications/${applicationIdOut}?${intent === "submit" ? "submitted" : "saved"}=1`);
}

/** Upload a photo, logo or document into the applicant's private folder and attach it. */
export async function uploadApplicationFileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant");
  const kind = field(formData, "kind");
  const applicationId = field(formData, "application_id");
  const file = formData.get("file");

  if (kind !== "logo" && kind !== "photo" && kind !== "document") return { error: "Unknown file type" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload" };
  if (file.size > MAX_DOCUMENT_BYTES) return { error: "File is too large" };

  const db = await createRequestClient();
  let uploaded: string | null = null;
  try {
    const appId = uuidSchema.parse(applicationId);
    uploaded = await uploadApplicationFile(db, ctx.user.id, appId, kind, new Uint8Array(await file.arrayBuffer()));
    await attachApplicationFile(db, ctx.user.id, appId, kind, uploaded);
  } catch (e) {
    if (uploaded) await db.storage.from(PRIVATE_BUCKET).remove([uploaded]); // don't orphan the object
    return actionError(e);
  }
  revalidatePath(`/merchant/applications/${applicationId}`);
  return { message: "File uploaded." };
}

export async function removeApplicationFileAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const applicationId = uuidSchema.parse(field(formData, "application_id"));
  const path = field(formData, "path");
  const db = await createRequestClient();
  try {
    if (await detachApplicationFile(db, ctx.user.id, applicationId, path)) {
      await db.storage.from(PRIVATE_BUCKET).remove([path]);
    }
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }
  revalidatePath(`/merchant/applications/${applicationId}`);
}

export async function deleteDraftAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const db = await createRequestClient();
  await deleteApplicationDraft(db, ctx.user.id, uuidSchema.parse(field(formData, "application_id")));
  revalidatePath("/merchant");
  redirect("/merchant");
}
