"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LANG_COOKIE, LOCALES } from "@/i18n/config";
import { safeRedirectPath } from "../security/rbac";
import { field } from "./shared";

/** Path and query of the page the visitor was on, taken from Referer and only if it is this site. */
async function returnPath(): Promise<string> {
  const h = await headers();
  try {
    const ref = new URL(h.get("referer") ?? "");
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && ref.host === host) return ref.pathname + ref.search;
  } catch {
    // no or malformed Referer: go home
  }
  return "/";
}

/** Remember the visitor's language (a non-sensitive preference) and return them to the page they were on. */
export async function setLanguageAction(formData: FormData): Promise<void> {
  const lang = field(formData, "lang");
  if ((LOCALES as readonly string[]).includes(lang)) {
    (await cookies()).set(LANG_COOKIE, lang, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false, path: "/" });
  }
  redirect(safeRedirectPath(await returnPath(), "/"));
}