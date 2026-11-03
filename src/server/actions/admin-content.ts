"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { requireRole } from "../auth/session";
import {
  addFeatured,
  createBanner,
  createCategory,
  createLocality,
  deleteBanner,
  removeFeatured,
  ServiceError,
  setBannerActive,
  updateCategory,
  updateLocality,
} from "../services";
import { createRequestClient } from "../supabase/server";
import { field } from "./shared";

/** Runs an admin change, then returns to the page with a short message (errors are user-safe text only). */
async function run(path: string, fn: (db: Awaited<ReturnType<typeof createRequestClient>>) => Promise<void>): Promise<never> {
  await requireRole("admin", path);
  let msg = "Saved.";
  let kind: "ok" | "error" = "ok";
  try {
    await fn(await createRequestClient());
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    msg = e instanceof ZodError ? (e.issues[0]?.message ?? "Please check the form.") : e instanceof ServiceError && e.code !== "DATABASE_ERROR" ? e.message : "That did not work. Please check the details and try again.";
    if (!(e instanceof ZodError) && !(e instanceof ServiceError)) console.error("Admin content action failed", e);
  }
  revalidatePath(path);
  revalidatePath("/");
  redirect(`${path}?${kind === "ok" ? "ok" : "error"}=${encodeURIComponent(msg)}`);
}

const H = "/admin/homepage";
const T = "/admin/taxonomy";

export async function createBannerAction(fd: FormData) {
  return run(H, (db) => createBanner(db, { title: field(fd, "title"), body: field(fd, "body"), link_url: field(fd, "link_url"), locality_id: field(fd, "locality_id"), display_order: field(fd, "display_order") || "0" }));
}
export async function toggleBannerAction(fd: FormData) {
  return run(H, (db) => setBannerActive(db, field(fd, "id"), field(fd, "active") === "true"));
}
export async function deleteBannerAction(fd: FormData) {
  return run(H, (db) => deleteBanner(db, field(fd, "id")));
}
export async function addFeaturedAction(fd: FormData) {
  return run(H, (db) => addFeatured(db, { storefront_id: field(fd, "storefront_id"), locality_id: field(fd, "locality_id"), position: field(fd, "position") || "0" }));
}
export async function removeFeaturedAction(fd: FormData) {
  return run(H, (db) => removeFeatured(db, field(fd, "id")));
}
export async function createCategoryAction(fd: FormData) {
  return run(T, (db) => createCategory(db, { name: field(fd, "name"), slug: field(fd, "slug"), default_template: field(fd, "default_template") || "standard_retail", display_order: field(fd, "display_order") || "100" }));
}
export async function updateCategoryAction(fd: FormData) {
  return run(T, (db) =>
    updateCategory(db, field(fd, "id"), {
      ...(field(fd, "name") ? { name: field(fd, "name") } : {}),
      ...(field(fd, "active") ? { is_active: field(fd, "active") === "true" } : {}),
      ...(field(fd, "display_order") ? { display_order: field(fd, "display_order") } : {}),
      ...(field(fd, "default_template") ? { default_template: field(fd, "default_template") } : {}),
    }),
  );
}
export async function createLocalityAction(fd: FormData) {
  return run(T, (db) => createLocality(db, { name: field(fd, "name"), slug: field(fd, "slug"), district: field(fd, "district"), pincode: field(fd, "pincode") }));
}
export async function updateLocalityAction(fd: FormData) {
  return run(T, (db) => updateLocality(db, field(fd, "id"), { ...(field(fd, "active") ? { is_active: field(fd, "active") === "true" } : {}) }));
}