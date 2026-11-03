import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { listMyApplications, listMyBusinesses } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "My shop" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export default async function MerchantHomePage() {
  const { user } = await requireUser("/merchant");
  const db = await createRequestClient();
  const [applications, businesses] = await Promise.all([listMyApplications(db, user.id), listMyBusinesses(db, user.id)]);
  const shops = businesses.flatMap((b) => b.business.shops.map((s) => ({ ...s, role: b.role })));

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your shops</h1>
        <Link href="/merchant/apply" className={buttonVariants()}>
          Add a shop
        </Link>
      </div>

      <section aria-labelledby="shops-h" className="space-y-3">
        <h2 id="shops-h" className="text-lg font-semibold">
          Live shops
        </h2>
        {shops.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No live shops yet</CardTitle>
              <CardDescription>Once NationX approves your application, your shop and its public page appear here.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          shops.map((shop) => (
            <Card key={shop.id}>
              <CardHeader>
                <CardTitle>{shop.name}</CardTitle>
                <CardDescription>
                  {shop.category.name} · {shop.locality.name} · you are {shop.role}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                {shop.storefront ? (
                  <>
                    <span className="break-all text-muted-foreground">/shop/{shop.storefront.slug}</span>
                    <Link href={`/shop/${shop.storefront.slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      View public page
                    </Link>
                  </>
                ) : null}
                <Link href={`/merchant/shops/${shop.id}`} className={buttonVariants({ size: "sm" })}>
                  Manage
                </Link>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section aria-labelledby="apps-h" className="space-y-3">
        <h2 id="apps-h" className="text-lg font-semibold">
          Applications
        </h2>
        {applications.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No applications yet</CardTitle>
              <CardDescription>Add your shop to get a free public page and be found by customers in Khammam.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          applications.map((app) => (
            <Card key={app.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{app.business_name}</CardTitle>
                  <StatusBadge status={app.status} />
                </div>
                <CardDescription>
                  {app.category?.name} · {app.locality?.name} · started {dateFormat.format(new Date(app.created_at))}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {app.status === "correction_requested" && app.correction_notes ? (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                    <strong>Changes requested:</strong> {app.correction_notes}
                  </p>
                ) : null}
                {app.status === "rejected" && app.rejection_reason ? (
                  <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <strong>Not approved:</strong> {app.rejection_reason}
                  </p>
                ) : null}
                <Link href={`/merchant/applications/${app.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {app.status === "draft" || app.status === "correction_requested" ? "Continue" : "View"}
                </Link>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
