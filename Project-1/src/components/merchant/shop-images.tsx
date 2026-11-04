import Image from "next/image";
import { FileUploader } from "@/components/merchant/file-uploader";
import { Button } from "@/components/ui/button";
import { removeGalleryImageAction, uploadShopImageAction } from "@/server/actions/shop";
import type { ManagedShop } from "@/server/validation";

const ACCEPT = "image/jpeg,image/png,image/webp";

/** Public storefront images: logo, banner and gallery. */
export function ShopImages({ shop }: { shop: ManagedShop }) {
  const sf = shop.storefront;
  if (!sf) return <p className="text-sm text-muted-foreground">This shop has no storefront yet.</p>;
  const hidden = { shop_id: shop.id };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          {sf.logo_url ? (
            <Image src={sf.logo_url} alt="Current logo" width={96} height={96} unoptimized className="size-24 rounded-lg border object-cover" />
          ) : (
            <p className="text-sm text-muted-foreground">No logo yet.</p>
          )}
          <FileUploader action={uploadShopImageAction} label="Logo" kind="logo" accept={ACCEPT} hidden={hidden} hint="JPEG, PNG or WebP, up to 5 MB. Square works best." />
        </div>
        <div className="space-y-3">
          {sf.banner_url ? (
            <Image src={sf.banner_url} alt="Current banner" width={240} height={96} unoptimized className="h-24 w-full rounded-lg border object-cover" />
          ) : (
            <p className="text-sm text-muted-foreground">No banner yet.</p>
          )}
          <FileUploader action={uploadShopImageAction} label="Banner" kind="banner" accept={ACCEPT} hidden={hidden} hint="Wide image, up to 5 MB." />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium">Gallery</h3>
        {sf.gallery_urls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No gallery photos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sf.gallery_urls.map((url) => (
              <li key={url} className="space-y-1">
                <Image src={url} alt="Gallery photo" width={200} height={150} unoptimized className="h-28 w-full rounded-lg border object-cover" />
                <form action={removeGalleryImageAction}>
                  <input type="hidden" name="shop_id" value={shop.id} />
                  <input type="hidden" name="url" value={url} />
                  <Button type="submit" variant="ghost" size="xs">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <FileUploader action={uploadShopImageAction} label="Add a gallery photo" kind="gallery" accept={ACCEPT} hidden={hidden} />
      </div>
    </div>
  );
}
