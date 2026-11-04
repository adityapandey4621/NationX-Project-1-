import { describe, expect, it } from "vitest";
import { describeDetails, MAX_TEXT_ANSWER, missingRequired, parseCategoryDetails } from "./category-details";
import { categoryAttributeInput, subcategoryInput, type CategoryAttribute } from "./taxonomy";

const CAT = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
let n = 0;
const attr = (over: Partial<CategoryAttribute> & Pick<CategoryAttribute, "key" | "field_type">): CategoryAttribute => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  category_id: CAT,
  label: over.key.replace("_", " "),
  help_text: null,
  options: [],
  is_required: false,
  display_order: n,
  is_active: true,
  ...over,
});
const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

const text = attr({ key: "brands", field_type: "text", label: "Brands" });
const num = attr({ key: "area", field_type: "number", label: "Area" });
const choice = attr({ key: "size", field_type: "choice", options: ["Small", "Large"], label: "Size", is_required: true });
const yn = attr({ key: "loose", field_type: "yes_no", label: "Loose" });
const all = [text, num, choice, yn];

describe("parseCategoryDetails", () => {
  it("reads every type into typed values", () => {
    const { details, errors } = parseCategoryDetails(form({ detail_brands: "  Fortune ", detail_area: "420", detail_size: "Large", detail_loose: "yes" }), all);
    expect(errors).toEqual({});
    expect(details).toEqual({ brands: "Fortune", area: 420, size: "Large", loose: true });
  });
  it("leaves blank answers out (drafts may be incomplete)", () => {
    const { details, errors } = parseCategoryDetails(form({ detail_brands: "  ", detail_area: "", detail_size: "", detail_loose: "" }), all);
    expect(details).toEqual({});
    expect(errors).toEqual({});
  });
  it("ignores fields for questions that do not exist for this category", () => {
    const { details } = parseCategoryDetails(form({ detail_unknown: "x", detail_brands: "A" }), all);
    expect(details).toEqual({ brands: "A" });
  });
  it("ignores answers for a different category's questions (keys are looked up in the supplied list only)", () => {
    expect(parseCategoryDetails(form({ detail_brands: "A" }), [num]).details).toEqual({});
  });
  it("refuses text over the limit", () => {
    const { details, errors } = parseCategoryDetails(form({ detail_brands: "x".repeat(MAX_TEXT_ANSWER + 1) }), all);
    expect(details).toEqual({});
    expect(errors.detail_brands?.[0]).toMatch(/at most 200/);
  });
  it("accepts exactly the limit", () => {
    expect(parseCategoryDetails(form({ detail_brands: "x".repeat(MAX_TEXT_ANSWER) }), all).errors).toEqual({});
  });
  it("accepts plain decimal numbers only", () => {
    for (const ok of ["0", "12", "-5", "3.5", "999999999"]) expect(parseCategoryDetails(form({ detail_area: ok }), all).errors, ok).toEqual({});
    for (const bad of ["abc", "1e3", "0x10", "12abc", "1,000", "NaN", "Infinity", "1.23456", "1000000000"]) {
      expect(parseCategoryDetails(form({ detail_area: bad }), all).errors.detail_area, bad).toBeDefined();
    }
  });
  it("accepts only a listed choice (case-sensitive), never a free value", () => {
    expect(parseCategoryDetails(form({ detail_size: "Small" }), all).errors).toEqual({});
    for (const bad of ["small", "Medium", "Small,Large"]) expect(parseCategoryDetails(form({ detail_size: bad }), all).errors.detail_size, bad).toBeDefined();
  });
  it("reads yes and no as booleans and refuses anything else", () => {
    expect(parseCategoryDetails(form({ detail_loose: "yes" }), all).details.loose).toBe(true);
    expect(parseCategoryDetails(form({ detail_loose: "no" }), all).details.loose).toBe(false);
    for (const bad of ["true", "YES", "1", "maybe"]) expect(parseCategoryDetails(form({ detail_loose: bad }), all).errors.detail_loose, bad).toBeDefined();
  });
  it("does not read a file upload as an answer", () => {
    const f = new FormData();
    f.append("detail_brands", new File(["x"], "x.txt"));
    expect(parseCategoryDetails(f, all).details).toEqual({});
  });
});

describe("missingRequired", () => {
  it("lists mandatory questions without an answer", () => {
    expect(Object.keys(missingRequired({}, all))).toEqual(["detail_size"]);
  });
  it("is empty once they are answered, and a false/zero answer counts as an answer", () => {
    expect(missingRequired({ size: "Small" }, all)).toEqual({});
    const mustHave = attr({ key: "flag", field_type: "yes_no", is_required: true });
    expect(missingRequired({ flag: false }, [mustHave])).toEqual({});
    const mustNum = attr({ key: "count", field_type: "number", is_required: true });
    expect(missingRequired({ count: 0 }, [mustNum])).toEqual({});
  });
});

describe("describeDetails", () => {
  it("shows labelled answers in order, Yes/No for booleans, and skips unanswered or switched-off questions", () => {
    const off = attr({ key: "old", field_type: "text", is_active: false, label: "Old" });
    const out = describeDetails({ brands: "Fortune", loose: false, area: 420, old: "x", size: "  " }, [...all, off]);
    expect(out).toEqual([
      { label: "Brands", value: "Fortune" },
      { label: "Area", value: "420" },
      { label: "Loose", value: "No" },
    ]);
  });
  it("ignores stored values of an unexpected type rather than printing them", () => {
    expect(describeDetails({ brands: { x: 1 }, area: "n/a" }, all)).toEqual([]);
  });
});

describe("admin input schemas", () => {
  it("a new list question needs a valid key, a type and at least two distinct choices", () => {
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "shop_size", label: "Shop size", field_type: "choice", options: ["S", "L"] }).success).toBe(true);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "shop_size", label: "Shop size", field_type: "choice", options: ["S"] }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "shop_size", label: "Shop size", field_type: "choice", options: ["S", "s"] }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "Bad Key", label: "Shop size", field_type: "text" }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "1abc", label: "Shop size", field_type: "text" }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, label: "Shop size", field_type: "text" }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ key: "ok_key", label: "Shop size", field_type: "text" }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "ok_key", label: "Shop size" }).success).toBe(false);
  });
  it("an edit needs neither key nor type, but the label is still checked", () => {
    expect(categoryAttributeInput.safeParse({ id: CAT, label: "Better label" }).success).toBe(true);
    expect(categoryAttributeInput.safeParse({ id: CAT, label: "x" }).success).toBe(false);
  });
  it("limits: at most 12 choices of at most 40 characters, hint at most 200", () => {
    const many = Array.from({ length: 13 }, (_, i) => `Option ${i}`);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "ok_key", label: "Label", field_type: "choice", options: many }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "ok_key", label: "Label", field_type: "choice", options: ["a", "x".repeat(41)] }).success).toBe(false);
    expect(categoryAttributeInput.safeParse({ category_id: CAT, key: "ok_key", label: "Label", field_type: "text", help_text: "x".repeat(201) }).success).toBe(false);
  });
  it("subcategory: name 2-60, web address lowercase letters/digits/single hyphens, order 0-10000", () => {
    expect(subcategoryInput.safeParse({ category_id: CAT, name: "Rice and grains", slug: "rice-and-grains" }).success).toBe(true);
    expect(subcategoryInput.safeParse({ category_id: CAT, name: "R", slug: "r-x" }).success).toBe(false);
    expect(subcategoryInput.safeParse({ category_id: CAT, name: "Rice", slug: "rice_grains" }).success).toBe(false);
    expect(subcategoryInput.safeParse({ category_id: CAT, name: "Rice", slug: "rice--grains" }).success).toBe(false);
    expect(subcategoryInput.safeParse({ category_id: CAT, name: "Rice", slug: "rice", display_order: 10001 }).success).toBe(false);
    expect(subcategoryInput.parse({ category_id: CAT, name: "Rice", slug: "RICE" }).slug).toBe("rice");
  });
});
