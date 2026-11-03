"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "../auth/actions";
import { requireUser } from "../auth/session";
import {
  removeStorefrontImage,
  setStorefrontImages,
  updateShopDetails,
  uploadStorefrontImage,
  MAX_IMAGE_BYTES,
} from "../services";
import { updateShopDetailsInput, uuidSchema, WEEKDAYS, OPERATING_MODELS } from "../validation";
import { actionError, field, nullableField, requireManagedShop, zodState } from "./shared";

const MAX_GALLERY = 12;

export async function updateShopAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant");
  const shopId = field(formData, "shop_id");

  const lat = field(formData, "latitude");
  const lng = field(formData, "longitude");
  const parsed = updateShopDetailsInput.safeParse({
    phone: field(formData, "phone"),
    whatsapp: nullableField(formData, "whatsapp"),
    address_line: field(formData, "address_line"),
    landmark: nullableField(formData, "landmark"),
    pincode: nullableField(formData, "pincode"),
    ...(lat !== "" || lng !== "" ? { latitude: lat === "" ? undefined : Number(lat), longitude: lng === "" ? undefined : Number(lng) } : {}),
    operating_hours: {
      opens: field(formData, "opens"),
      closes: field(formData, "closes"),
      closed_days: formData.getAll("closed_days").filter((d) => (WEEKDAYS as readonly string[]).includes(String(d))),
    },
    operating_models: formData.getAll("operating_models").filter((m) => (OPERATING_MODELS as readonly string[]).includes(String(m))),
    headline: nullableField(formData, "headline"),
    description: nullableField(formData, "description"),
  });
  if (!parsed.success) return zodState(parsed.error);

  try {
    const { db, shop } = await requireManagedShop(ctx.user.id, shopId);
    await updateShopDetails(db, shop.id, parsed.data);
    const slug = shop.storefront?.slug;
    revalidatePath(`/merchant/shops/${shop.id}`);
    if (slug) revalidatePath(`/shop/${slug}`);
  } catch (e) {
    return actionError(e);
  }
  return { message: "Changes saved. Your public page is updated." };
}

export async function uploadShopImageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant");
  const kind = field(formData, "kind");
  const file = formData.get("file");
  if (kind !== "logo" && kind !== "banner" && kind !== "gallery") return { error: "Unknown image type" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload" };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image is too large (maximum 5 MB)" };

  try {
    const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
    const sf = shop.storefront;
    if (!sf) return { error: "This shop has no storefront yet" };
    if (kind === "gallery" && sf.gallery_urls.length >= MAX_GALLERY) {
      return { error: `A gallery can hold up to ${MAX_GALLERY} images` };
    }

    const { url } = await uploadStorefrontImage(db, shop.id, kind, new Uint8Array(await file.arrayBuffer()));
    if (kind === "gallery") {
      await setStorefrontImages(db, shop.id, { gallery_urls: [...sf.gallery_urls, url] });
    } else {
      const old = kind === "logo" ? sf.logo_url : sf.banner_url;
      await setStorefrontImages(db, shop.id, kind === "logo" ? { logo_url: url } : { banner_url: url });
      if (old) await removeStorefrontImage(db, shop.id, old);
    }
    revalidatePath(`/merchant/shops/${shop.id}`);
    revalidatePath(`/shop/${sf.slug}`);
  } catch (e) {
    return actionError(e);
  }
  return { message: "Image uploaded." };
}

export async function removeGalleryImageAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const shopId = uuidSchema.parse(field(formData, "shop_id"));
  const url = field(formData, "url");
  const { db, shop } = await requireManagedShop(ctx.user.id, shopId);
  const sf = shop.storefront;
  if (!sf || !sf.gallery_urls.includes(url)) return;
  await setStorefrontImages(db, shop.id, { gallery_urls: sf.gallery_urls.filter((u) => u !== url) });
  await removeStorefrontImage(db, shop.id, url);
  revalidatePath(`/merchant/shops/${shop.id}`);
  revalidatePath(`/shop/${sf.slug}`);
}
