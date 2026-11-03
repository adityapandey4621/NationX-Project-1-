import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileUploader } from "@/components/merchant/file-uploader";
import { ProductForm } from "@/components/merchant/product-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteProductAction, uploadProductImageAction } from "@/server/actions/catalogue";
import { requireUser } from "@/server/auth/session";
import { getManagedShop, listShopProducts, MANAGER_ROLES } from "@/server/services";
import { createRequestClient } from "@/server/supabase/server";
import { uuidSchema } from "@/server/validation";

export const metadata: Metadata = { title: "Edit item" };

export default async function EditProductPage({ params }: { params: Promise<{ shopId: string; productId: string }> }) {
  const { shopId, productId } = await params;
  const { user } = await requireUser(`/merchant/shops/${shopId}/products/${productId}`);
  const db = await createRequestClient();

  const found = await getManagedShop(db, user.id, shopId);
  if (!found || !(MANAGER_ROLES as readonly string[]).includes(found.role) || !uuidSchema.safeParse(productId).success) notFound();
  const product = (await listShopProducts(db, found.shop.id)).find((p) => p.id === productId);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{product.name}</h1>
        <Link href={`/merchant/shops/${found.shop.id}/products`} className={buttonVariants({ variant: "outline" })}>
          ← All items
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Item details</CardTitle>
        </CardHeader>
        <CardContent>
          <ProductForm shopId={found.shop.id} product={product} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photo</CardTitle>
          <CardDescription>A clear photo of the item. JPEG, PNG or WebP, up to 5 MB.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {product.image_url ? (
            <Image src={product.image_url} alt={`Photo of ${product.name}`} width={160} height={160} unoptimized className="size-40 rounded-lg border object-cover" />
          ) : (
            <p className="text-sm text-muted-foreground">No photo yet.</p>
          )}
          <FileUploader
            action={uploadProductImageAction}
            label={product.image_url ? "Replace photo" : "Upload photo"}
            kind="product"
            accept="image/jpeg,image/png,image/webp"
            hidden={{ shop_id: found.shop.id, product_id: product.id }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Remove item</CardTitle>
          <CardDescription>This removes it from your public page and from search. Use “Hide” instead if you only want it off temporarily.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deleteProductAction}>
            <input type="hidden" name="shop_id" value={found.shop.id} />
            <input type="hidden" name="product_id" value={product.id} />
            <Button type="submit" variant="destructive">
              Delete item
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
