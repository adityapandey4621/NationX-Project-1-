import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import { deriveSupportedActions, getManagedShop, getPublicStorefront, updateShopDetails } from "./storefront-service";

const SHOP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BIZ = "22222222-2222-4222-8222-222222222222";
const USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TS = "2026-11-02T10:00:00+00:00";

const shopRow = {
  id: SHOP, business_id: BIZ, name: "Sri Ram Kirana", shop_code: "MAIN", category_id: BIZ, subcategory_id: null, locality_id: BIZ,
  address_line: "Near Old Bus Stand", landmark: null, latitude: null, longitude: null, pincode: "507001", phone: "+919876543210",
  whatsapp: null, operating_models: ["visit_only"], operating_hours: { opens: "09:00", closes: "21:00", closed_days: [] },
  is_active: true, created_at: TS, updated_at: TS,
};
const storefrontRow = {
  id: BIZ, shop_id: SHOP, slug: "sri-ram-kirana-gandhi-chowk", headline: null, description: null, logo_url: null, banner_url: null,
  gallery_urls: [], template_name: "grocery", is_published: true, visibility_status: "visible", visibility_reason: null, visibility_changed_at: null, supported_actions: ["call", "directions"],
  ordering_enabled: false, meta_title: null, meta_description: null, created_at: TS, updated_at: TS,
};

describe("getPublicStorefront", () => {
  it("does not query for malformed slugs", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    expect(await getPublicStorefront(db, "Not A Slug; drop table")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("explicitly requires published + visible, in addition to RLS", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    expect(await getPublicStorefront(db, "some-shop")).toBeNull();
    const eqs = calls[0]?.ops.filter(([o]) => o === "eq").map(([, a]) => a);
    expect(eqs).toContainEqual(["slug", "some-shop"]);
    expect(eqs).toContainEqual(["is_published", true]);
    expect(eqs).toContainEqual(["visibility_status", "visible"]);
  });

  it("returns the parsed storefront with its shop", async () => {
    const row = { ...storefrontRow, shop: { ...shopRow, locality: { name: "Gandhi Chowk", slug: "gandhi-chowk", pincode: "507001" }, category: { name: "Kirana", slug: "kirana" } } };
    const { db } = fakeDb(() => ({ data: row, error: null }));
    const sf = await getPublicStorefront(db, "sri-ram-kirana-gandhi-chowk");
    expect(sf?.shop.name).toBe("Sri Ram Kirana");
    expect(sf?.ordering_enabled).toBe(false);
  });
});

describe("deriveSupportedActions", () => {
  it("always offers call and directions", () => {
    expect(deriveSupportedActions({ whatsapp: null, operating_models: ["visit_only"] })).toEqual(["call", "directions"]);
  });
  it("adds whatsapp, appointment and inquiry from the data", () => {
    expect(deriveSupportedActions({ whatsapp: "+919876543210", operating_models: ["appointment", "quotation"] })).toEqual([
      "call", "directions", "whatsapp", "appointment", "inquiry",
    ]);
  });
  it("never offers ordering", () => {
    expect(deriveSupportedActions({ whatsapp: "+919876543210", operating_models: ["delivery", "pickup"] })).not.toContain("order");
  });
});

describe("updateShopDetails", () => {
  it("drops platform-controlled fields (name, slug, publication, ordering) before sending", async () => {
    const { db, calls } = fakeDb((c) =>
      c.target === "shops" ? { data: { whatsapp: null, operating_models: ["visit_only"] }, error: null } : { data: { id: BIZ }, error: null },
    );
    await updateShopDetails(db, SHOP, {
      phone: "+919876543210", name: "Renamed", slug: "x", is_published: false, ordering_enabled: true, business_id: BIZ,
    } as never);
    const shopPatch = opArgs(calls.find((c) => c.target === "shops"), "update")?.[0] as Record<string, unknown>;
    expect(shopPatch).toEqual({ phone: "+919876543210" });
    const sfPatch = opArgs(calls.find((c) => c.target === "storefronts"), "update")?.[0] as Record<string, unknown>;
    expect(sfPatch).not.toHaveProperty("slug");
    expect(sfPatch).not.toHaveProperty("is_published");
    expect(sfPatch).not.toHaveProperty("ordering_enabled");
  });

  it("recomputes supported actions when WhatsApp changes", async () => {
    const { db, calls } = fakeDb((c) =>
      c.target === "shops" ? { data: { whatsapp: "+919876543210", operating_models: ["visit_only"] }, error: null } : { data: { id: BIZ }, error: null },
    );
    await updateShopDetails(db, SHOP, { whatsapp: "+919876543210" });
    const sfPatch = opArgs(calls.find((c) => c.target === "storefronts"), "update")?.[0] as Record<string, unknown>;
    expect(sfPatch.supported_actions).toEqual(["call", "directions", "whatsapp"]);
  });

  it("reports FORBIDDEN when RLS matched no row (not a manager of this shop)", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    await expect(updateShopDetails(db, SHOP, { phone: "+919876543210" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an empty update and a lone latitude", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await expect(updateShopDetails(db, SHOP, {})).rejects.toThrow();
    await expect(updateShopDetails(db, SHOP, { latitude: 17.2 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("getManagedShop", () => {
  const membership = [{ role: "owner", business: { id: BIZ, name: "Biz", shops: [{ ...shopRow, locality: { name: "Gandhi Chowk" }, category: { name: "Kirana" }, storefront: storefrontRow }] } }];

  it("returns the shop and role when the user is a member", async () => {
    const { db } = fakeDb(() => ({ data: membership, error: null }));
    const found = await getManagedShop(db, USER, SHOP);
    expect(found?.role).toBe("owner");
    expect(found?.shop.storefront?.slug).toBe("sri-ram-kirana-gandhi-chowk");
  });
  it("returns null for shops the user is not a member of", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    expect(await getManagedShop(db, USER, SHOP)).toBeNull();
    expect(await getManagedShop(db, USER, "not-a-uuid")).toBeNull();
  });
});
