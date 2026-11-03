"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALITY_COOKIE } from "@/lib/constants";
import { isSupabaseConfigured } from "../config/env";
import { findLocalityBySlug } from "../services";
import { createRequestClient } from "../supabase/server";
import { field } from "./shared";

/**
 * Remember the customer's locality (a non-sensitive slug) for next visits.
 * Empty value = "all areas". The slug is validated against active localities.
 */
export async function setLocalityAction(formData: FormData): Promise<void> {
  const slug = field(formData, "locality");
  // Return to the page the visitor was on, but only to a known listing page on this site.
  const next = field(formData, "next");
  const target = /^\/(explore|search|category\/[a-z0-9-]+)?$/.test(next) ? next : "/";
  const jar = await cookies();
  if (slug === "" || !isSupabaseConfigured()) {
    jar.delete(LOCALITY_COOKIE);
  } else if (await findLocalityBySlug(await createRequestClient(), slug)) {
    jar.set(LOCALITY_COOKIE, slug, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true, path: "/" });
  }
  redirect(target);
}
