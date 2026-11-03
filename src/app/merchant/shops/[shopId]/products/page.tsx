import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/merchant/product-form";
import { Price } from "@/components/product/price";
import { StockBadge } from "@/components/product/stock-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STOCK_LABELS } from "@/lib/stock";
import { confirmStockAction, setPublishedAction, setStockAction } from "@/server/actions/catalogue";
import { requireUser } from "@/server/auth/session";
import { getManagedShop, listShopProducts, MANAGER_ROLES } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { MAX_PRODUCTS_PER_SHOP, STOCK_STATUSES } from "@/server/validation";

export const metadata: Metadata = { title: "Items" };

export default async function ShopProductsPage({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params;
  const { user } = await requireUser(`/merchant/shops/${shopId}/products`);
  const db = await createRequestClient();

  // Another merchant's shop is simply "not found" (membership checked here and by RLS).
  const found = await getManagedShop(db, user.id, shopId);
  if (!found) notFound();
  const { shop, role } = found;
  const canEdit = (MANAGER_ROLES as readonly string[]).includes(role);
  const products = await listShopProducts(db, shop.id);
  const needsConfirm = products.filter((p) => p.is_published && p.stock_status !== "call_to_confirm" && p.effective_stock_status === "call_to_confirm");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Items · {shop.name}</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} of {MAX_PRODUCTS_PER_SHOP} items · {products.filter((p) => p.is_published).length} shown on your public page
          </p>
        </div>
        <Link href={`/merchant/shops/${shop.id}`} className={buttonVariants({ variant: "outline" })}>
          ← Shop settings
        </Link>
      </div>

      {needsConfirm.length > 0 ? (
        <Card role="status">
          <CardHeader>
            <CardTitle>{needsConfirm.length} {needsConfirm.length === 1 ? "item needs" : "items need"} a fresh stock check</CardTitle>
            <CardDescription>
              Customers see “Call to confirm” for items whose stock hasn&apos;t been confirmed in the last 3 days. Press “Stock is still correct” on the item, or set its availability again.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Add an item</CardTitle>
            <CardDescription>Only list what you really sell. Leave the price blank if it varies; customers will see “Call for price”.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProductForm shopId={shop.id} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>View-only access</CardTitle>
            <CardDescription>Only owners and managers can change items.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {products.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No items yet</CardTitle>
            <CardDescription>Items you add appear on your public page and can be found in search.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {products.map((p) => (
            <li key={p.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start gap-4">
                  {p.image_url ? (
                    <Image src={p.image_url} alt="" width={64} height={64} unoptimized className="size-16 rounded-lg border object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium">
                      {p.name}
                      {p.name_te ? <span lang="te" className="ml-2 text-muted-foreground">{p.name_te}</span> : null}
                    </p>
                    <Price price={p.price} mrp={p.mrp} unit={p.unit} />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StockBadge status={p.effective_stock_status} />
                      {p.stock_status !== p.effective_stock_status ? <span>You set “{STOCK_LABELS[p.stock_status]}”, but it needs reconfirming.</span> : null}
                      {!p.is_published ? <span className="rounded-full border px-2 py-0.5">Hidden from customers</span> : null}
                    </div>
                  </div>
                  {canEdit ? (
                    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                      <form action={setStockAction} className="flex flex-wrap gap-1" aria-label={`Set availability of ${p.name}`}>
                        <input type="hidden" name="shop_id" value={shop.id} />
                        <input type="hidden" name="product_id" value={p.id} />
                        {STOCK_STATUSES.map((s) => (
                          <Button key={s} type="submit" name="stock_status" value={s} size="xs" variant={p.stock_status === s ? "default" : "outline"}>
                            {STOCK_LABELS[s]}
                          </Button>
                        ))}
                      </form>
                      {p.stock_status !== "call_to_confirm" ? (
                        <form action={confirmStockAction}>
                          <input type="hidden" name="shop_id" value={shop.id} />
                          <input type="hidden" name="product_id" value={p.id} />
                          <Button type="submit" size="xs" variant="outline">
                            Stock is still correct
                          </Button>
                        </form>
                      ) : null}
                      <form action={setPublishedAction}>
                        <input type="hidden" name="shop_id" value={shop.id} />
                        <input type="hidden" name="product_id" value={p.id} />
                        <input type="hidden" name="publish" value={String(!p.is_published)} />
                        <Button type="submit" size="xs" variant="ghost">
                          {p.is_published ? "Hide" : "Show"}
                        </Button>
                      </form>
                      <Link href={`/merchant/shops/${shop.id}/products/${p.id}`} className={buttonVariants({ size: "xs", variant: "ghost" })}>
                        Edit
                      </Link>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
