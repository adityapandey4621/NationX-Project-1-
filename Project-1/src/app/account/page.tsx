import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/auth/profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const { user, profile, roles } = await requireUser("/account");

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Your account</h1>
      <p className="text-sm">
        <Link href="/account/requests" className="underline underline-offset-4">
          My “Help me find it” requests
        </Link>
      </p>

      {profile ? (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Signed in as {user.email ?? profile.email}. Roles:{" "}
              {roles.length ? roles.join(", ") : "none"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm profile={profile} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Profile not found</CardTitle>
            <CardDescription>
              Your sign-in worked but no profile exists for this account yet. Please contact NationX support.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
