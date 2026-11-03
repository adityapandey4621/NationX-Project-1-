import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured } from "@/server/config/env";
import { safeRedirectPath } from "@/server/security/rbac";
import { createRequestClient } from "@/server/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/** Landing route for the link in Supabase confirmation emails. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = OTP_TYPES.find((t) => t === searchParams.get("type"));
  const next = safeRedirectPath(searchParams.get("next"));

  if (tokenHash && type && isSupabaseConfigured()) {
    const db = await createRequestClient();
    const { error } = await db.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(new URL("/sign-in?error=confirmation_failed", request.url));
}
