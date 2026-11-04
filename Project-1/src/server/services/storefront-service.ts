import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  managedShopSchema,
  publicStorefrontSchema,
  slugSchema,
  updateShopDetailsInput,
  uuidSchema,
  type ManagedShop,
  type PublicStorefront,
  type UpdateShopDetailsInput,
} from "../validation";
import { fromPostgrest, ServiceError } from "./service-result";

/**
 * Public storefront by slug. Filters are explicit AND enforced by RLS, so
 * unpublished, hidden or suspended storefronts yield null for everyone —
 * including admins and owners viewing the public URL.
 */
export async function getPublicStorefront(db: SupabaseClient, slug: string): Promise<PublicStorefront | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const { data, error } = await db
    .from("storefronts")
    .select("*, shop:shops!inner(*, locality:localities(name, slug, pincode), category:categories(name, slug), subcategory:subcategories(name, slug))")
    .eq("slug", parsed.data)
    .eq("is_published", true)
    .eq("visibility_status", "visible")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "getPublicStorefront");
  return data ? publicStorefrontSchema.parse(data) : null;
}

const myBusinessSchema = z.object({
  role: z.enum(["owner", "manager", "employee"]),
  business: z.object({
    id: uuidSchema,
    name: z.string(),
    shops: z.array(managedShopSchema),
  }),
});
export type MyBusiness = z.infer<typeof myBusinessSchema>;

/** Businesses (and their shops/storefronts) the user is a member of. Membership is enforced by RLS. */
export async function listMyBusinesses(db: SupabaseClient, userId: string): Promise<MyBusiness[]> {
  const { data, error } = await db
    .from("business_members")
    .select(
      "role, business:businesses(id, name, shops(*, locality:localities(name), category:categories(name), storefront:storefronts(*)))",
    )
    .eq("user_id", uuidSchema.parse(userId));
  if (error) throw fromPostgrest(error, "listMyBusinesses");
  return z.array(myBusinessSchema).parse(data);
}

/** One shop, only if the user is a member of its business. */
export async function getManagedShop(
  db: SupabaseClient,
  userId: string,
  shopId: string,
): Promise<{ shop: ManagedShop; role: MyBusiness["role"] } | null> {
  const id = uuidSchema.safeParse(shopId);
  if (!id.success) return null;
  for (const b of await listMyBusinesses(db, userId)) {
    const shop = b.business.shops.find((s) => s.id === id.data);
    if (shop) return { shop, role: b.role };
  }
  return null;
}

/** Storefront slug of a business's main shop (admin/owner view of the published result). */
export async function getBusinessStorefrontSlug(db: SupabaseClient, businessId: string): Promise<string | null> {
  const { data, error } = await db
    .from("shops")
    .select("storefront:storefronts(slug)")
    .eq("business_id", uuidSchema.parse(businessId))
    .eq("shop_code", "MAIN")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "getBusinessStorefrontSlug");
  const parsed = z.object({ storefront: z.object({ slug: z.string() }).nullable() }).nullable().parse(data);
  return parsed?.storefront?.slug ?? null;
}

export const MANAGER_ROLES = ["owner", "manager"] as const;

/**
 * The caller's shop, or an error: NOT_FOUND when they are not a member (another
 * merchant's shop looks the same as a missing one), FORBIDDEN when `manage` is
 * required and they are only an employee. RLS enforces the same rules in the database.
 */
export async function requireShopAccess(
  db: SupabaseClient,
  userId: string,
  shopId: string,
  access: "read" | "manage",
): Promise<ManagedShop> {
  const found = await getManagedShop(db, userId, shopId);
  if (!found) throw new ServiceError("NOT_FOUND", "Shop not found");
  if (access === "manage" && !(MANAGER_ROLES as readonly string[]).includes(found.role)) {
    throw new ServiceError("FORBIDDEN", "Only owners and managers can change this shop");
  }
  return found.shop;
}

/** Mirrors the SQL in approve_merchant_application (migration 004). */
export function deriveSupportedActions(shop: { whatsapp: string | null; operating_models: readonly string[] }): string[] {
  const actions = ["call", "directions"];
  if (shop.whatsapp) actions.push("whatsapp");
  if (shop.operating_models.includes("appointment")) actions.push("appointment");
  if (shop.operating_models.includes("quotation")) actions.push("inquiry");
  return actions;
}

/**
 * Manager edit of permitted fields. Name, category, locality, slug, publication
 * and ordering are not editable here (and are blocked by database triggers).
 */
export async function updateShopDetails(
  db: SupabaseClient,
  shopId: string,
  input: UpdateShopDetailsInput,
): Promise<void> {
  const id = uuidSchema.parse(shopId);
  const { headline, description, announcement, closure_note, closed_until, ...shopFields } = updateShopDetailsInput.parse(input);

  let shopRow: { whatsapp: string | null; operating_models: string[] } | null = null;
  if (Object.keys(shopFields).length > 0) {
    const { data, error } = await db.from("shops").update(shopFields).eq("id", id).select("whatsapp, operating_models").maybeSingle();
    if (error) throw fromPostgrest(error, "updateShopDetails");
    if (!data) throw new ServiceError("FORBIDDEN", "You are not permitted to edit this shop");
    shopRow = z.object({ whatsapp: z.string().nullable(), operating_models: z.array(z.string()) }).parse(data);
  }

  const storefrontPatch: Record<string, unknown> = {};
  if (headline !== undefined) storefrontPatch.headline = headline;
  if (description !== undefined) storefrontPatch.description = description;
  if (announcement !== undefined) storefrontPatch.announcement = announcement;
  if (closure_note !== undefined) storefrontPatch.closure_note = closure_note;
  // A date means nothing without its note: clearing the note reopens the shop, so the date goes with it.
  if (closed_until !== undefined) storefrontPatch.closed_until = closure_note === null ? null : closed_until;
  else if (closure_note === null) storefrontPatch.closed_until = null;
  if (shopRow) storefrontPatch.supported_actions = deriveSupportedActions(shopRow);
  if (Object.keys(storefrontPatch).length > 0) {
    const { data, error } = await db.from("storefronts").update(storefrontPatch).eq("shop_id", id).select("id").maybeSingle();
    if (error) throw fromPostgrest(error, "updateShopDetails.storefront");
    if (!data) throw new ServiceError("FORBIDDEN", "You are not permitted to edit this storefront");
  }
}

export interface StorefrontImagePatch {
  logo_url?: string | null;
  banner_url?: string | null;
  gallery_urls?: string[];
}

export async function setStorefrontImages(db: SupabaseClient, shopId: string, patch: StorefrontImagePatch): Promise<void> {
  const { data, error } = await db
    .from("storefronts")
    .update(patch)
    .eq("shop_id", uuidSchema.parse(shopId))
    .select("id")
    .maybeSingle();
  if (error) throw fromPostgrest(error, "setStorefrontImages");
  if (!data) throw new ServiceError("FORBIDDEN", "You are not permitted to edit this storefront");
}
