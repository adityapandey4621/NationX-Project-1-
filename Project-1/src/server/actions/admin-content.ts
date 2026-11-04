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
  saveCategoryAttribute,
  saveSubcategory,
  ServiceError,
  setBannerActive,
  setHomepageSection,
  updateCategory,
  updateLocality,
} from "../services";
import { createRequestClient } from "../supabase/server";
import { slugify } from "../validation";
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

/** Show/hide and reorder one section of the homepage. */
export async function setHomepageSectionAction(fd: FormData) {
  return run(H, async (db) => {
    await setHomepageSection(db, { section_key: field(fd, "section_key"), is_visible: field(fd, "visible") === "true", display_order: field(fd, "display_order") });
  });
}
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
/** `active` comes from the pressed button ("true"/"false"); absent means a new item that starts on. */
const activeFlag = (fd: FormData) => (field(fd, "active") ? field(fd, "active") === "true" : true);

/** Add (no id) or change (id) a subcategory. A new one's web address defaults to "<category>-<name>" so it is unique. */
export async function saveSubcategoryAction(fd: FormData) {
  const id = field(fd, "id");
  return run(T, async (db) => {
    await saveSubcategory(db, {
      id: id || undefined,
      category_id: field(fd, "category_id") || undefined,
      name: field(fd, "name"),
      slug: id ? undefined : field(fd, "slug") || [field(fd, "category_slug"), slugify(field(fd, "name"))].filter(Boolean).join("-"),
      display_order: field(fd, "display_order") || "100",
      is_active: activeFlag(fd),
    });
  });
}

/** Define (no id) or change (id) a question on a category. Choices are typed one per line. */
export async function saveCategoryAttributeAction(fd: FormData) {
  const id = field(fd, "id");
  return run(T, async (db) => {
    await saveCategoryAttribute(db, {
      id: id || undefined,
      category_id: field(fd, "category_id") || undefined,
      key: id ? undefined : field(fd, "key") || slugify(field(fd, "label")).replace(/-/g, "_"),
      label: field(fd, "label"),
      help_text: field(fd, "help_text") || undefined,
      field_type: id ? undefined : field(fd, "field_type") || undefined,
      options: String(fd.get("options") ?? "").split(/\r?\n/).map((o) => o.trim()).filter(Boolean),
      is_required: fd.get("is_required") === "on",
      display_order: field(fd, "display_order") || "100",
      is_active: activeFlag(fd),
    });
  });
}

export async function createLocalityAction(fd: FormData) {
  return run(T, (db) => createLocality(db, { name: field(fd, "name"), slug: field(fd, "slug"), district: field(fd, "district"), pincode: field(fd, "pincode") }));
}
export async function updateLocalityAction(fd: FormData) {
  return run(T, (db) => updateLocality(db, field(fd, "id"), { ...(field(fd, "active") ? { is_active: field(fd, "active") === "true" } : {}) }));
}