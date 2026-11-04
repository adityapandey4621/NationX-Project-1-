import { describe, expect, it } from "vitest";
import { diffApplication } from "./application-diff";

const base = {
  business_name: "Sri Ram Kirana",
  category_id: "cat-1",
  subcategory_id: null,
  business_description: "Daily groceries",
  contact_phone: "+919848099111",
  whatsapp_number: null,
  contact_email: null,
  address_line1: "Old Bus Stand",
  address_line2: null,
  landmark: null,
  locality_id: "loc-1",
  pincode: "507001",
  latitude: 17.2473,
  longitude: 80.1514,
  opening_time: "09:00:00",
  closing_time: "21:00:00",
  weekly_off_days: ["tuesday", "sunday"],
  operating_models: ["visit_only", "pickup"],
  category_specific_data: { size: "Large" },
  declaration_accepted: true,
};

describe("diffApplication", () => {
  it("returns nothing when there is no snapshot (never corrected) or nothing changed", () => {
    expect(diffApplication(null, base)).toEqual([]);
    expect(diffApplication(undefined, base)).toEqual([]);
    expect(diffApplication(base, { ...base })).toEqual([]);
  });
  it("lists only the fields that changed, in a fixed order, with before and after", () => {
    const rows = diffApplication(base, { ...base, address_line1: "Full new address", business_name: "Sri Ram Stores" });
    expect(rows.map((r) => r.field)).toEqual(["business_name", "address_line1"]);
    expect(rows[1]).toEqual({ field: "address_line1", label: "Address", before: "Old Bus Stand", after: "Full new address" });
  });
  it("shows an empty value as a dash and treats blank, null and whitespace as the same thing", () => {
    expect(diffApplication(base, { ...base, landmark: "   " })).toEqual([]);
    expect(diffApplication(base, { ...base, landmark: "Near temple" })[0]).toMatchObject({ before: "—", after: "Near temple" });
    expect(diffApplication(base, { ...base, business_description: null })[0]).toMatchObject({ before: "Daily groceries", after: "—" });
  });
  it("ignores the order of days and models, and the seconds in times", () => {
    expect(diffApplication(base, { ...base, weekly_off_days: ["sunday", "tuesday"], operating_models: ["pickup", "visit_only"], opening_time: "09:00", closing_time: "21:00:00" })).toEqual([]);
  });
  it("detects a real change to a set, a time and a number", () => {
    const rows = diffApplication(base, { ...base, weekly_off_days: ["sunday"], opening_time: "08:30:00", latitude: 17.25 });
    expect(rows.map((r) => r.field)).toEqual(["latitude", "opening_time", "weekly_off_days"]);
    expect(rows.find((r) => r.field === "weekly_off_days")).toMatchObject({ before: "sunday, tuesday", after: "sunday" });
    expect(rows.find((r) => r.field === "opening_time")).toMatchObject({ before: "09:00", after: "08:30" });
  });
  it("treats 17.2473 and the string '17.2473' as equal (the database returns numbers as given)", () => {
    expect(diffApplication(base, { ...base, latitude: "17.2473" })).toEqual([]);
  });
  it("resolves ids to names when given a lookup, and falls back to the id", () => {
    const names: Record<string, string> = { "cat-1": "Kirana", "cat-2": "Salons" };
    const resolve = (_f: string, id: string) => names[id];
    expect(diffApplication(base, { ...base, category_id: "cat-2" }, resolve)[0]).toMatchObject({ before: "Kirana", after: "Salons" });
    expect(diffApplication(base, { ...base, category_id: "cat-9" }, resolve)[0]).toMatchObject({ after: "cat-9" });
  });
  it("compares the category answers regardless of key order and ignores empty answers", () => {
    const a = { ...base, category_specific_data: { size: "Large", brands: "Fortune" } };
    expect(diffApplication(a, { ...a, category_specific_data: { brands: "Fortune", size: "Large", extra: "" } })).toEqual([]);
    const rows = diffApplication(a, { ...a, category_specific_data: { size: "Small", brands: "Fortune", loose: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "category_specific_data", before: "brands: Fortune; size: Large", after: "brands: Fortune; loose: Yes; size: Small" });
  });
  it("shows booleans as Yes / No", () => {
    expect(diffApplication(base, { ...base, declaration_accepted: false })[0]).toMatchObject({ before: "Yes", after: "No" });
  });
  it("never reports fields the snapshot does not track (status, files, ids of the application itself)", () => {
    const rows = diffApplication(base, { ...base, status: "submitted", logo_storage_path: "x/y.png", id: "abc", reviewed_by: "z" });
    expect(rows).toEqual([]);
  });
});
