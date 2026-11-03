import { describe, expect, it } from "vitest";
import { createProductInput, searchProductsInput, updateProductInput, visibilityInput } from "./catalogue";

const base = { name: "Sugar" };

describe("createProductInput", () => {
  it("defaults to unknown stock and a published item, with nothing invented", () => {
    const out = createProductInput.parse(base);
    expect(out).toMatchObject({
      name: "Sugar", name_te: null, description: null, price: null, mrp: null, unit: null,
      stock_status: "call_to_confirm", is_published: true,
    });
  });

  it("trims the name and rejects a blank or over-long one", () => {
    expect(createProductInput.parse({ name: "  Rice  " }).name).toBe("Rice");
    expect(createProductInput.safeParse({ name: "   " }).success).toBe(false);
    expect(createProductInput.safeParse({ name: "x".repeat(161) }).success).toBe(false);
  });

  it("accepts rupees with up to two decimals only", () => {
    expect(createProductInput.safeParse({ ...base, price: 45.5 }).success).toBe(true);
    expect(createProductInput.safeParse({ ...base, price: 0 }).success).toBe(true);
    expect(createProductInput.safeParse({ ...base, price: 10.123 }).success).toBe(false);
  });

  it("rejects negative, absurd and non-numeric prices", () => {
    expect(createProductInput.safeParse({ ...base, price: -1 }).success).toBe(false);
    expect(createProductInput.safeParse({ ...base, price: 10_000_001 }).success).toBe(false);
    expect(createProductInput.safeParse({ ...base, price: Number("abc") }).success).toBe(false);
  });

  it("rejects an MRP below the selling price, with the error on the MRP field", () => {
    const r = createProductInput.safeParse({ ...base, price: 50, mrp: 40 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.mrp?.[0]).toMatch(/MRP/);
    expect(createProductInput.safeParse({ ...base, price: 50, mrp: 50 }).success).toBe(true);
    expect(createProductInput.safeParse({ ...base, mrp: 40 }).success).toBe(true);
  });

  it("rejects unknown stock statuses", () => {
    expect(createProductInput.safeParse({ ...base, stock_status: "plenty" }).success).toBe(false);
  });

  it("ignores fields a manager must not set (shop, stock time, ids)", () => {
    const out = createProductInput.parse({ ...base, shop_id: "x", stock_confirmed_at: "2000-01-01", id: "y" } as never);
    expect(out).not.toHaveProperty("shop_id");
    expect(out).not.toHaveProperty("stock_confirmed_at");
    expect(out).not.toHaveProperty("id");
  });
});

describe("updateProductInput", () => {
  it("requires at least one field", () => {
    expect(updateProductInput.safeParse({}).success).toBe(false);
  });
  it("allows a partial patch and still checks MRP against price", () => {
    expect(updateProductInput.safeParse({ stock_status: "in_stock" }).success).toBe(true);
    expect(updateProductInput.safeParse({ price: 10, mrp: 5 }).success).toBe(false);
  });
});

describe("searchProductsInput", () => {
  it("requires a query and strips control characters", () => {
    expect(searchProductsInput.safeParse({ q: "   " }).success).toBe(false);
    expect(searchProductsInput.parse({ q: " su\u0000gar\n rice " }).q).toBe("su gar rice");
    expect(searchProductsInput.safeParse({ q: "x".repeat(81) }).success).toBe(false);
  });
  it("applies defaults and bounds", () => {
    const out = searchProductsInput.parse({ q: "rice" });
    expect(out).toMatchObject({ sort: "relevance", limit: 12, offset: 0 });
    expect(searchProductsInput.safeParse({ q: "rice", limit: 51 }).success).toBe(false);
    expect(searchProductsInput.safeParse({ q: "rice", sort: "cheapest" }).success).toBe(false);
  });
  it("treats blank filters as absent but rejects a malformed id", () => {
    expect(searchProductsInput.parse({ q: "rice", locality_id: "" }).locality_id).toBeUndefined();
    expect(searchProductsInput.safeParse({ q: "rice", locality_id: "nope" }).success).toBe(false);
  });
});

describe("visibilityInput", () => {
  it("requires a real reason to hide or suspend", () => {
    expect(visibilityInput.safeParse({ status: "suspended" }).success).toBe(false);
    expect(visibilityInput.safeParse({ status: "hidden", reason: "  " }).success).toBe(false);
    expect(visibilityInput.safeParse({ status: "hidden", reason: "ab" }).success).toBe(false);
    expect(visibilityInput.safeParse({ status: "suspended", reason: "Fraud report" }).success).toBe(true);
  });
  it("lets an admin reactivate without a reason", () => {
    expect(visibilityInput.safeParse({ status: "visible" }).success).toBe(true);
  });
  it("rejects unknown statuses and over-long reasons", () => {
    expect(visibilityInput.safeParse({ status: "banned", reason: "whatever" }).success).toBe(false);
    expect(visibilityInput.safeParse({ status: "hidden", reason: "x".repeat(501) }).success).toBe(false);
  });
});
