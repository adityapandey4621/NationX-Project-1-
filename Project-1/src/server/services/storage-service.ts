import type { SupabaseClient } from "@supabase/supabase-js";
import { uuidSchema } from "../validation";
import { ServiceError } from "./service-result";
import { validateUpload, type UploadKind } from "./upload-validation";

export const PRIVATE_BUCKET = "private-merchant-kyc";
export const PUBLIC_BUCKET = "public-storefront-assets";

async function put(db: SupabaseClient, bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await db.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (error) throw new ServiceError("DATABASE_ERROR", `Upload failed: ${error.message}`, error);
}

/**
 * Applicant upload into their private folder `{user}/{application}/…`.
 * RLS on storage.objects (migration 005) independently enforces the folder.
 */
export async function uploadApplicationFile(
  db: SupabaseClient,
  userId: string,
  applicationId: string,
  kind: Extract<UploadKind, "logo" | "photo" | "document">,
  bytes: Uint8Array,
): Promise<string> {
  const uid = uuidSchema.parse(userId);
  const appId = uuidSchema.parse(applicationId);
  const { mime, ext } = validateUpload(bytes, kind);
  const path = `${uid}/${appId}/${kind}-${crypto.randomUUID()}.${ext}`;
  await put(db, PRIVATE_BUCKET, path, bytes, mime);
  return path;
}

/** Manager upload into the public storefront bucket `{shop}/…`; returns path and public URL. */
export async function uploadStorefrontImage(
  db: SupabaseClient,
  shopId: string,
  kind: Extract<UploadKind, "logo" | "banner" | "gallery" | "product">,
  bytes: Uint8Array,
): Promise<{ path: string; url: string }> {
  const sid = uuidSchema.parse(shopId);
  const { mime, ext } = validateUpload(bytes, kind);
  const path = `${sid}/${kind}-${crypto.randomUUID()}.${ext}`;
  await put(db, PUBLIC_BUCKET, path, bytes, mime);
  return { path, url: db.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl };
}

/** Best-effort removal of a replaced/removed public image (path recovered from its URL). */
export async function removeStorefrontImage(db: SupabaseClient, shopId: string, url: string): Promise<void> {
  const marker = `/${PUBLIC_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  if (!path.startsWith(`${uuidSchema.parse(shopId)}/`)) return;
  await db.storage.from(PUBLIC_BUCKET).remove([path]);
}

/** Short-lived signed URLs for reviewing private files (applicant or admin; RLS decides). */
export async function signPrivateFiles(db: SupabaseClient, paths: readonly string[], expiresInSeconds = 600) {
  if (paths.length === 0) return [] as { path: string; url: string | null }[];
  const { data, error } = await db.storage.from(PRIVATE_BUCKET).createSignedUrls([...paths], expiresInSeconds);
  if (error) throw new ServiceError("DATABASE_ERROR", `Could not prepare file links: ${error.message}`, error);
  return data.map((d) => ({ path: d.path ?? "", url: d.signedUrl ?? null }));
}
