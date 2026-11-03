"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "../auth/actions";
import { requireUser } from "../auth/session";
import {
  confirmProductStock,
  createProduct,
  deleteProduct,
  listShopProducts,
  MAX_IMAGE_BYTES,
  removeStorefrontImage,
  setProductImage,
  updateProduct,
  uploadStorefrontImage,
} from "../services";
import { createProductInput, stockStatusSchema, updateProductInput, uuidSchema } from "../validation";
import { actionError, field, nullableField, requireManagedShop, zodState } from "./shared";

/** "" → null; otherwise the number (NaN is rejected by the schema). */
function moneyField(formData: FormData, name: string): number | null {
  const v = field(formData, name).replace(/,/g, "");
  return v === "" ? null : Number(v);
}

function productFields(formData: FormData) {
  return {
    name: field(formData, "name"),
    name_te: nullableField(formData, "name_te"),
    description: nullableField(formData, "description"),
    price: moneyField(formData, "price"),
    mrp: moneyField(formData, "mrp"),
    unit: nullableField(formData, "unit"),
    stock_status: stockStatusSchema.catch("call_to_confirm").parse(field(formData, "stock_status")),
    is_published: formData.get("is_published") === "on",
  };
}

async function refresh(shopId: string, slug: string | undefined) {
  revalidatePath(`/merchant/shops/${shopId}/products`);
  if (slug) revalidatePath(`/shop/${slug}`);
}

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant");
  const shopId = field(formData, "shop_id");
  const parsed = createProductInput.safeParse(productFields(formData));
  if (!parsed.success) return zodState(parsed.error);
  try {
    const { db, shop } = await requireManagedShop(ctx.user.id, shopId);
    await createProduct(db, shop.id, parsed.data);
    await refresh(shop.id, shop.storefront?.slug);
  } catch (e) {
    return actionError(e);
  }
  return { message: "Item added." };
}

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant");
  const parsed = updateProductInput.safeParse(productFields(formData));
  if (!parsed.success) return zodState(parsed.error);
  try {
    const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
    const productId = uuidSchema.parse(field(formData, "product_id"));
    await updateProduct(db, shop.id, productId, parsed.data);
    await refresh(shop.id, shop.storefront?.slug);
  } catch (e) {
    return actionError(e);
  }
  return { message: "Item saved." };
}

/** Quick stock change from the list; stamps a fresh confirmation time in the database. */
export async function setStockAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
  const status = stockStatusSchema.parse(field(formData, "stock_status"));
  await updateProduct(db, shop.id, uuidSchema.parse(field(formData, "product_id")), { stock_status: status });
  await refresh(shop.id, shop.storefront?.slug);
}

export async function confirmStockAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
  await confirmProductStock(db, shop.id, uuidSchema.parse(field(formData, "product_id")));
  await refresh(shop.id, shop.storefront?.slug);
}

export async function setPublishedAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
  await updateProduct(db, shop.id, uuidSchema.parse(field(formData, "product_id")), {
    is_published: field(formData, "publish") === "true",
  });
  await refresh(shop.id, shop.storefront?.slug);
}

export async function deleteProductAction(formData: FormData): Promise<void> {
  const ctx = await requireUser("/merchant");
  const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
  const productId = uuidSchema.parse(field(formData, "product_id"));
  const existing = (await listShopProducts(db, shop.id)).find((p) => p.id === productId);
  await deleteProduct(db, shop.id, productId);
  if (existing?.image_url) await removeStorefrontImage(db, shop.id, existing.image_url);
  await refresh(shop.id, shop.storefront?.slug);
  redirect(`/merchant/shops/${shop.id}/products`);
}

export async function uploadProductImageAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUser("/merchant");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload" };
  if (file.size > MAX_IMAGE_BYTES) return { error: "Image is too large (maximum 5 MB)" };
  try {
    const { db, shop } = await requireManagedShop(ctx.user.id, field(formData, "shop_id"));
    const productId = uuidSchema.parse(field(formData, "product_id"));
    const existing = (await listShopProducts(db, shop.id)).find((p) => p.id === productId);
    if (!existing) return { error: "Item not found" };
    const { url } = await uploadStorefrontImage(db, shop.id, "product", new Uint8Array(await file.arrayBuffer()));
    await setProductImage(db, shop.id, productId, url);
    if (existing.image_url) await removeStorefrontImage(db, shop.id, existing.image_url);
    await refresh(shop.id, shop.storefront?.slug);
  } catch (e) {
    return actionError(e);
  }
  return { message: "Photo uploaded." };
}
