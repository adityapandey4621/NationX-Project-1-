import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import { activeModules, getHomepageData, searchStorefronts, toApiShop } from "./discovery-service";

const ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const LOC = "33333333-3333-4333-8333-333333333333";
const CAT = "22222222-2222-4222-8222-222222222222";
const TS = "2026-11-02T10:00:00+00:00";

const row = (n: number, total = 25) => ({
  storefront_id: ID, slug: `shop-${n}`, shop_id: ID, shop_name: `Shop ${n}`, headline: null, snippet: "Daily groceries", logo_url: null,
  category_name: "Kirana", category_slug: "kirana", locality_name: "Gandhi Chowk", locality_slug: "gandhi-chowk",
  operating_models: ["visit_only"], created_at: TS, rank: 0.5, total_count: String(total), // bigint arrives as a string
});

describe("searchStorefronts", () => {
  it("maps validated input to the database function (and only that function)", async () => {
    const { db, calls } = fakeDb(() => ({ data: [row(1)], error: null }));
    await searchStorefronts(db, { q: "  kirana  ", category_id: CAT, locality_id: LOC, model: "pickup", sort: "name", limit: "5", offset: "10" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe("rpc:search_storefronts");
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({
      p_query: "kirana", p_category_id: CAT, p_locality_id: LOC, p_model: "pickup", p_sort: "name", p_limit: 5, p_offset: 10, p_lat: null, p_lng: null, p_ids: null,
    });
  });

  it("passes a shared position through, and only as a complete pair", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await searchStorefronts(db, { sort: "nearest", lat: "17.247", lng: "80.151" });
    expect(opArgs(calls[0], "rpc")?.[0]).toMatchObject({ p_sort: "nearest", p_lat: 17.247, p_lng: 80.151 });
    await searchStorefronts(db, { lat: "17.247" });
    expect(opArgs(calls[1], "rpc")?.[0]).toMatchObject({ p_lat: null, p_lng: null });
  });

  it("rejects out-of-range coordinates before touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await expect(searchStorefronts(db, { lat: "91", lng: "10" })).rejects.toThrow();
    await expect(searchStorefronts(db, { lat: "10", lng: "181" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("treats blank parameters as absent and applies defaults", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await searchStorefronts(db, { q: "", category_id: "", locality_id: " ", model: "", sort: "" });
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({
      p_query: null, p_category_id: null, p_locality_id: null, p_model: null, p_sort: "relevance", p_limit: 12, p_offset: 0, p_lat: null, p_lng: null, p_ids: null,
    });
  });

  it("strips control characters and rejects over-long queries before touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await searchStorefronts(db, { q: "oil\u0000\u0007\n  lamp" });
    expect((opArgs(calls[0], "rpc")?.[0] as { p_query: string }).p_query).toBe("oil lamp");
    await expect(searchStorefronts(db, { q: "x".repeat(81) })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("rejects malformed filters, sorts and paging", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    for (const bad of [
      { category_id: "not-a-uuid" }, { locality_id: "1 OR 1=1" }, { model: "teleport" }, { sort: "price" },
      { limit: "0" }, { limit: "51" }, { limit: "abc" }, { offset: "-1" }, { offset: "10001" },
    ]) {
      await expect(searchStorefronts(db, bad)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it("reports the total once and parses string bigints", async () => {
    const { db } = fakeDb(() => ({ data: [row(1, 25), row(2, 25)], error: null }));
    const page = await searchStorefronts(db, { limit: 12, offset: 12 });
    expect(page.total).toBe(25);
    expect(page.results).toHaveLength(2);
    expect(page.offset).toBe(12);
  });

  it("returns an empty page (total 0) when nothing matches", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    expect(await searchStorefronts(db, { q: "zzzz" })).toMatchObject({ results: [], total: 0 });
  });

  it("surfaces database failures as domain errors without leaking details", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { code: "XX000", message: "relation internal_secret missing", details: "", hint: "" } }));
    await expect(searchStorefronts(db, {})).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it("toApiShop drops the page-level total", () => {
    const shop = toApiShop({ ...row(1), total_count: 9 } as never);
    expect(shop).not.toHaveProperty("total_count");
    expect(shop).toHaveProperty("slug", "shop-1");
  });
});

describe("activeModules (REQ-HOM-05 / REQ-HOM-08)", () => {
  const flags = [
    { key: "grocery", is_enabled: false, enabled_localities: [] },
    { key: "shared_delivery", is_enabled: true, enabled_localities: [LOC] },
    { key: "khata", is_enabled: true, enabled_localities: [] },
  ];
  it("never reports a disabled module as active", () => {
    expect(activeModules(flags, LOC).grocery).toBe(false);
  });
  it("enables locality-restricted modules only in those localities", () => {
    expect(activeModules(flags, LOC).shared_delivery).toBe(true);
    expect(activeModules(flags, CAT).shared_delivery).toBe(false);
    expect(activeModules(flags, null).shared_delivery).toBe(false);
  });
  it("enables unrestricted modules everywhere", () => {
    expect(activeModules(flags, null).khata).toBe(true);
  });
});

describe("getHomepageData", () => {
  it("assembles categories, localities, newest shops and modules from the database only", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.target === "rpc:public_category_counts") return { data: [{ id: CAT, name: "Kirana", slug: "kirana", display_order: 10, shop_count: "3" }], error: null };
      if (c.target === "rpc:public_locality_counts") return { data: [{ id: LOC, name: "Gandhi Chowk", slug: "gandhi-chowk", district: "Khammam", shop_count: "3" }], error: null };
      if (c.target === "rpc:search_storefronts") return { data: [row(1, 3)], error: null };
      return { data: [{ key: "grocery", is_enabled: false, enabled_localities: [] }], error: null };
    });
    const home = await getHomepageData(db, LOC);
    expect(home.categories[0]).toMatchObject({ slug: "kirana", shop_count: 3 });
    expect(home.localities[0]?.shop_count).toBe(3);
    expect(home.recent.results).toHaveLength(1);
    expect(home.modules).toEqual({ grocery: false });
    const search = calls.find((c) => c.target === "rpc:search_storefronts");
    expect(opArgs(search, "rpc")?.[0]).toMatchObject({ p_sort: "newest", p_limit: 6, p_locality_id: LOC, p_query: null });
  });

  it("shows empty lists, not fabricated shops, when the directory is empty", async () => {
    const { db } = fakeDb((c) => ({ data: c.target === "feature_flags" ? [] : [], error: null }));
    const home = await getHomepageData(db);
    expect(home.recent.results).toEqual([]);
    expect(home.recent.total).toBe(0);
    expect(home.categories).toEqual([]);
  });
});
