import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext } from "@/server/auth/session";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getAuthContext()) redirect("/account");

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>One NationX account for shopping and, later, running your shop.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SignUpForm />
          <p className="text-sm text-muted-foreground">
            Already registered?{" "}
            <Link href="/sign-in" className="font-medium text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
