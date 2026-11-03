"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "../config/env";
import { safeRedirectPath } from "../security/rbac";
import { ServiceError, updateOwnProfile } from "../services";
import { createRequestClient } from "../supabase/server";
import { signInInput, signUpInput, updateProfileInput } from "../validation";
import { describeSignInError, describeSignUpError } from "./errors";
import { requireUser } from "./session";

/** State returned to forms via `useActionState`. */
export interface FormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

const NOT_CONFIGURED: FormState = {
  error: "Sign-in is temporarily unavailable. Please try again later.",
};

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function originUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpInput.safeParse({
    full_name: field(formData, "full_name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    password: field(formData, "password"),
    preferred_language: field(formData, "preferred_language") || "en",
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const { password, email, ...profile } = parsed.data;
  const db = await createRequestClient();
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      // Display data only. Roles are never read from metadata (migration 003).
      data: { full_name: profile.full_name, phone: profile.phone, preferred_language: profile.preferred_language },
      emailRedirectTo: `${await originUrl()}/auth/confirm?next=/account`,
    },
  });
  if (error) return { error: describeSignUpError(error) };

  // With email confirmation enabled Supabase returns no session yet.
  if (!data.session) {
    return { message: "Almost done! Check your email for a confirmation link, then sign in." };
  }
  redirect("/account");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInInput.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;

  const db = await createRequestClient();
  const { error } = await db.auth.signInWithPassword(parsed.data);
  if (error) return { error: describeSignInError(error) };

  redirect(safeRedirectPath(field(formData, "next")));
}

export async function signOutAction(): Promise<void> {
  if (isSupabaseConfigured()) {
    const db = await createRequestClient();
    await db.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/account");
  const parsed = updateProfileInput.safeParse({
    full_name: field(formData, "full_name"),
    phone: field(formData, "phone"),
    preferred_language: field(formData, "preferred_language"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const db = await createRequestClient();
  try {
    await updateOwnProfile(db, ctx.user.id, parsed.data);
  } catch (e) {
    if (e instanceof ServiceError && e.code === "CONFLICT") {
      return { fieldErrors: { phone: ["This phone number is already in use."] } };
    }
    return { error: "We couldn't save your changes. Please try again." };
  }
  revalidatePath("/account");
  return { message: "Profile updated." };
}
