import type { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import {
  confirmProductStock,
  createProduct,
  deleteProduct,
  listPublicProducts,
  listStorefrontsForAdmin,
  searchProducts,
  setProductImage,
  setStorefrontVisibility,
  updateProduct,
} from "./catalogue-service";

const SHOP = "20000000-0000-4000-8000-00000000000a";
const OTHER_SHOP = "20000000-0000-4000-8000-00000000000b";
const PRODUCT = "40000000-0000-4000-8000-0000000000a1";
const SF = "30000000-0000-4000-8000-00000000000a";
const TS = "2026-11-02T10:00:00+00:00";

const pgError = (code: string, message = "boom"): PostgrestError =>
  ({ code, message, details: "", hint: "", name: "PostgrestError" }) as PostgrestError;

const productRow = (over: Record<string, unknown> = {}) => ({
  id: PRODUCT, shop_id: SHOP, name: "Sugar", name_te: null, description: null, price: 45, mrp: null, unit: "kg",
  stock_status: "in_stock", stock_confirmed_at: TS, effective_stock_status: "in_stock", image_url: null, display_order: 0,
  is_published: true, created_at: TS, updated_at: TS, ...over,
});

describe("createProduct", () => {
  it("takes the shop from the argument, never from the input", async () => {
    const { db, calls } = fakeDb(() => ({ data: { id: PRODUCT }, error: null }));
    await createProduct(db, SHOP, { name: "Sugar", shop_id: OTHER_SHOP } as never);
    const row = opArgs(calls[0], "insert")?.[0] as Record<string, unknown>;
    expect(row.shop_id).toBe(SHOP);
    expect(calls[0]?.target).toBe("storefront_products");
  });

  it("defaults unknown stock to call_to_confirm", async () => {
    const { db, calls } = fakeDb(() => ({ data: { id: PRODUCT }, error: null }));
    await createProduct(db, SHOP, { name: "Sugar" });
    expect(opArgs(calls[0], "insert")?.[0]).toMatchObject({ stock_status: "call_to_confirm", price: null, is_published: true });
  });

  it("validates before touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: { id: PRODUCT }, error: null }));
    await expect(createProduct(db, SHOP, { name: "Sugar", price: -5 })).rejects.toThrow();
    await expect(createProduct(db, "not-a-uuid", { name: "Sugar" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("explains the per-shop limit and refusals in plain language", async () => {
    const full = fakeDb(() => ({ data: null, error: pgError("23514", "a shop can list up to 500 items") })).db;
    await expect(createProduct(full, SHOP, { name: "Sugar" })).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "a shop can list up to 500 items" });
    const denied = fakeDb(() => ({ data: null, error: pgError("42501") })).db;
    await expect(createProduct(denied, SHOP, { name: "Sugar" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("updateProduct / deleteProduct / confirmProductStock / setProductImage", () => {
  it("scope every statement by product AND shop", async () => {
    const { db, calls } = fakeDb(() => ({ data: { id: PRODUCT }, error: null }));
    await updateProduct(db, SHOP, PRODUCT, { price: 50 });
    await deleteProduct(db, SHOP, PRODUCT);
    await confirmProductStock(db, SHOP, PRODUCT);
    await setProductImage(db, SHOP, PRODUCT, null);
    for (const call of calls) {
      const eqs = call.ops.filter(([o]) => o === "eq").map(([, a]) => a);
      expect(eqs).toContainEqual(["id", PRODUCT]);
      expect(eqs).toContainEqual(["shop_id", SHOP]);
    }
  });

  it("report NOT_FOUND when the row is invisible to the caller (another merchant's item, or RLS)", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    await expect(updateProduct(db, SHOP, PRODUCT, { price: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteProduct(db, SHOP, PRODUCT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirmProductStock(db, SHOP, PRODUCT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setProductImage(db, SHOP, PRODUCT, "https://x/y.png")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuse an empty patch and an invalid price before calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: { id: PRODUCT }, error: null }));
    await expect(updateProduct(db, SHOP, PRODUCT, {})).rejects.toThrow();
    await expect(updateProduct(db, SHOP, PRODUCT, { price: 10, mrp: 5 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("confirmProductStock sends only the confirmation marker (the database stamps the real time)", async () => {
    const { db, calls } = fakeDb(() => ({ data: { id: PRODUCT }, error: null }));
    await confirmProductStock(db, SHOP, PRODUCT);
    const patch = opArgs(calls[0], "update")?.[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["stock_confirmed_at"]);
  });
});

describe("listPublicProducts", () => {
  it("filters to published items explicitly (owners can read their unpublished ones through RLS)", async () => {
    const { db, calls } = fakeDb(() => ({ data: [productRow()], error: null }));
    const out = await listPublicProducts(db, SHOP);
    expect(calls[0]?.target).toBe("products_with_stock");
    expect(calls[0]?.ops).toContainEqual(["eq", ["is_published", true]]);
    expect(out[0]?.effective_stock_status).toBe("in_stock");
  });

  it("rejects rows with an unknown stock label rather than showing them", async () => {
    const { db } = fakeDb(() => ({ data: [productRow({ effective_stock_status: "plenty" })], error: null }));
    await expect(listPublicProducts(db, SHOP)).rejects.toThrow();
  });
});

describe("searchProducts", () => {
  const resultRow = {
    product_id: PRODUCT, name: "Sugar", name_te: null, unit: "kg", price: 45, mrp: null, image_url: null,
    effective_stock_status: "call_to_confirm", shop_name: "Shop A", storefront_slug: "shop-a", locality_name: "Gandhi Chowk",
    locality_slug: "gandhi-chowk", category_name: "Kirana", rank: 3, total_count: "7",
  };

  it("calls the database function with sanitised parameters and reports the total once", async () => {
    const { db, calls } = fakeDb(() => ({ data: [resultRow], error: null }));
    const page = await searchProducts(db, { q: "  sugar  ", sort: "price_asc", limit: 6 });
    expect(calls[0]?.target).toBe("rpc:search_products");
    expect(opArgs(calls[0], "rpc")?.[0]).toMatchObject({ p_query: "sugar", p_sort: "price_asc", p_limit: 6, p_offset: 0, p_locality_id: null });
    expect(page.total).toBe(7);
    expect(page.results[0]?.effective_stock_status).toBe("call_to_confirm");
  });

  it("refuses an empty query without calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await expect(searchProducts(db, { q: "   " })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("returns an honest empty page", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    expect(await searchProducts(db, { q: "nothing" })).toMatchObject({ results: [], total: 0 });
  });
});

describe("setStorefrontVisibility", () => {
  it("passes the status and reason to the audited database function", async () => {
    const { db, calls } = fakeDb(() => ({ data: { storefront_id: SF, status: "suspended", changed: true }, error: null }));
    const out = await setStorefrontVisibility(db, SF, { status: "suspended", reason: "Fraud report" });
    expect(calls[0]?.target).toBe("rpc:set_storefront_visibility");
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_storefront_id: SF, p_status: "suspended", p_reason: "Fraud report" });
    expect(out).toEqual({ status: "suspended", changed: true });
  });

  it("requires a reason to take a storefront offline, before any database call", async () => {
    const { db, calls } = fakeDb(() => ({ data: {}, error: null }));
    await expect(setStorefrontVisibility(db, SF, { status: "hidden" })).rejects.toThrow();
    await expect(setStorefrontVisibility(db, SF, { status: "suspended", reason: "no" })).rejects.toThrow();
    await expect(setStorefrontVisibility(db, "nope", { status: "visible" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("maps database refusals: non-admin, unknown storefront", async () => {
    const forbidden = fakeDb(() => ({ data: null, error: pgError("42501", "administrator role required") })).db;
    await expect(setStorefrontVisibility(forbidden, SF, { status: "visible" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const missing = fakeDb(() => ({ data: null, error: pgError("P0002") })).db;
    await expect(setStorefrontVisibility(missing, SF, { status: "visible" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listStorefrontsForAdmin", () => {
  const row = {
    id: SF, slug: "shop-a", is_published: true, visibility_status: "visible", visibility_reason: null,
    visibility_changed_at: null, created_at: TS,
    shop: { name: "Shop A", is_active: true, locality: { name: "L" }, category: { name: "C" }, business: { name: "B" } },
  };

  it("applies the status filter, clamps paging and neutralises filter-syntax characters in the search", async () => {
    const { db, calls } = fakeDb(() => ({ data: [row], error: null }));
    await listStorefrontsForAdmin(db, { q: "sri%,(x)_*\\", status: "suspended", limit: 9999, offset: -3 });
    const ops = calls[0]?.ops ?? [];
    expect(ops).toContainEqual(["eq", ["visibility_status", "suspended"]]);
    expect(ops).toContainEqual(["range", [0, 99]]);
    expect(opArgs(calls[0], "ilike")).toEqual(["shops.name", "%sri x%"]);
  });

  it("does not add a name filter for a blank search", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await listStorefrontsForAdmin(db, { q: "   " });
    expect(opArgs(calls[0], "ilike")).toBeUndefined();
  });
});
