import { appConfig } from "../config";
import { normalizeIndianPhone } from "./format";
import { getSupabase } from "./supabase";

export class AuthFailure extends Error {
  constructor(message: string, public readonly field?: "email" | "password" | "phone") {
    super(message);
    this.name = "AuthFailure";
  }
}

/** Uniform, non-leaky wording (never reveals whether an email exists). */
export function describeAuthError(error: { message?: string; status?: number; code?: string }, mode: "sign-in" | "sign-up"): AuthFailure {
  const msg = (error.message ?? "").toLowerCase();
  if (msg.includes("fetch") || msg.includes("network") || error.status === 0) {
    return new AuthFailure("Could not reach the server. Check your connection and try again.");
  }
  if (error.status === 429 || msg.includes("rate limit")) return new AuthFailure("Too many attempts. Please wait a few minutes and try again.");
  if (mode === "sign-in") {
    if (msg.includes("not confirmed")) return new AuthFailure("Please confirm your email first - check your inbox for the link.");
    return new AuthFailure("Incorrect email or password.");
  }
  if (msg.includes("already") || msg.includes("registered")) return new AuthFailure("An account with these details may already exist. Try signing in.");
  if (msg.includes("phone")) return new AuthFailure("This phone number is already in use.", "phone");
  if (msg.includes("password")) return new AuthFailure("Choose a stronger password (at least 8 characters).", "password");
  return new AuthFailure("We could not create your account. Please check your details and try again.");
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw describeAuthError(error, "sign-in");
}

/** Returns true when the project requires email confirmation before the first sign-in. */
export async function signUp(v: { full_name: string; email: string; phone: string; password: string }): Promise<{ needsConfirmation: boolean }> {
  const phone = normalizeIndianPhone(v.phone);
  if (!phone) throw new AuthFailure("Enter a valid 10-digit Indian mobile number.", "phone");
  const { data, error } = await getSupabase().auth.signUp({
    email: v.email.trim().toLowerCase(),
    password: v.password,
    options: {
      // Display data only. The database assigns the customer role itself; metadata can never grant roles.
      data: { full_name: v.full_name.trim(), phone, preferred_language: "en" },
      emailRedirectTo: `${appConfig().webUrl}/auth/confirm?next=/account`,
    },
  });
  if (error) throw describeAuthError(error, "sign-up");
  return { needsConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut({ scope: "local" });
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}