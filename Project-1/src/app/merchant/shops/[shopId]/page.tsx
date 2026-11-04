import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopForm } from "@/components/merchant/shop-form";
import { ShopImages } from "@/components/merchant/shop-images";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/auth/session";
import { getManagedShop, getShopStats, MANAGER_ROLES } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";

export const metadata: Metadata = { title: "Manage shop" };

export default async function ManageShopPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  const { user } = await requireUser(`/merchant/shops/${shopId}`);
  const db = await createRequestClient();

  // Membership is verified here (and by RLS): another merchant's shop is simply "not found".
  const found = await getManagedShop(db, user.id, shopId);
  if (!found) notFound();
  const { shop, role } = found;
  const canEdit = (MANAGER_ROLES as readonly string[]).includes(role);
  // Real counts only; if they cannot be loaded the card says so instead of showing zeros.
  const stats = shop.storefront
    ? await getShopStats(db, shop.id, 30).catch((e: unknown) => {
        console.error("Shop stats failed", e);
        return null;
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{shop.name}</h1>
          <p className="text-sm text-muted-foreground">
            {shop.category.name} · {shop.locality.name} · you are {role}
          </p>
        </div>
        {shop.storefront ? (
          <Link href={`/shop/${shop.storefront.slug}`} className={buttonVariants({ variant: "outline" })}>
            Preview public page
          </Link>
        ) : null}
      </div>

      {shop.storefront && shop.storefront.visibility_status !== "visible" ? (
        <Card role="alert">
          <CardHeader>
            <CardTitle>
              Your public page is {shop.storefront.visibility_status === "suspended" ? "suspended" : "hidden"}
            </CardTitle>
            <CardDescription>
              Customers cannot see it or find it in search.
              {shop.storefront.visibility_reason ? <> Reason from NationX: {shop.storefront.visibility_reason}</> : null} Contact NationX
              to have it restored.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {shop.storefront ? (
        <Card>
          <CardHeader>
            <CardTitle>Your page, last 30 days</CardTitle>
            <CardDescription>How many times your page was opened and how often customers tapped Call, WhatsApp or Directions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats ? (
              <>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Page views", stats.views],
                      ["Calls tapped", stats.calls],
                      ["WhatsApp taps", stats.whatsapp],
                      ["Directions taps", stats.directions],
                    ] as const
                  ).map(([label, n]) => (
                    <div key={label} className="rounded-xl border bg-card p-3">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="text-2xl font-bold tracking-tight">{n}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  These count taps and page opens, not sales or actual phone calls. Nothing about the visitor is recorded. Counting began when this feature launched, so earlier visits are not included.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">We couldn&apos;t load your numbers right now. Please try again later.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <CardDescription>The products and services you list, with price and availability. Shown on your public page and in search.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={`/merchant/shops/${shop.id}/products`} className={buttonVariants({ variant: canEdit ? "default" : "outline" })}>
            {canEdit ? "Manage items" : "View items"}
          </Link>
        </CardContent>
      </Card>

      {!canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>View-only access</CardTitle>
            <CardDescription>Only owners and managers can edit this shop.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Shop details</CardTitle>
              <CardDescription>
                Changes appear on your public page immediately. To change your shop name, category or area, contact NationX (these
                need re-verification).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShopForm shop={shop} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
            </CardHeader>
            <CardContent>
              <ShopImages shop={shop} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
