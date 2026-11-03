import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/server/auth/session";
import { countApplicationsByStatus } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { APPLICATION_STATUSES } from "@/server/validation";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminHomePage() {
  await requireRole("admin", "/admin");
  const db = await createRequestClient();
  const counts = await countApplicationsByStatus(db);
  const statuses = APPLICATION_STATUSES.filter((s) => s !== "draft");

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
      <Card>
        <CardHeader>
          <CardTitle>Merchant applications</CardTitle>
          <CardDescription>
            <Link href="/admin/applications" className="underline underline-offset-4">
              Open the review queue
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Live storefronts</CardTitle>
          <CardDescription>
            <Link href="/admin/storefronts" className="underline underline-offset-4">
              Hide, suspend or reactivate a storefront
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Homepage</CardTitle>
          <CardDescription>
            <Link href="/admin/homepage" className="underline underline-offset-4">
              Banners and featured shops
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Categories and areas</CardTitle>
          <CardDescription>
            <Link href="/admin/taxonomy" className="underline underline-offset-4">
              Add or turn off categories and areas
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Area waitlist</CardTitle>
          <CardDescription>
            <Link href="/admin/waitlist" className="underline underline-offset-4">
              People waiting for shops to open in their area
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Help Me Find It</CardTitle>
          <CardDescription>
            <Link href="/admin/help-requests" className="underline underline-offset-4">
              Open the customer request queue
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {statuses.map((s) => (
          <li key={s}>
            <Link href={`/admin/applications?status=${s}`} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted">
              <StatusBadge status={s} />
              <span className="text-lg font-semibold">{counts[s] ?? 0}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
