import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext } from "@/server/auth/session";
import { safeRedirectPath } from "@/server/security/rbac";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = safeRedirectPath(next);
  if (await getAuthContext()) redirect(target);

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Welcome back to NationX.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error === "confirmation_failed" ? (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              That confirmation link is invalid or has expired. Try signing in, or sign up again.
            </p>
          ) : null}
          <SignInForm next={target} />
          <p className="text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/sign-up" className="font-medium text-foreground underline underline-offset-4">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
