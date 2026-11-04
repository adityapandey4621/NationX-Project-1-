import { describe, expect, it } from "vitest";
import { parseApplicationFormData } from "./application-form";
import { saveApplicationDraftInput, submitApplicationInput } from "./merchant-application";

const CATEGORY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const LOCALITY_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

const base: Array<[string, string]> = [
  ["business_name", "  Sri Ram Kirana  "],
  ["category_id", CATEGORY_ID],
  ["locality_id", LOCALITY_ID],
  ["contact_phone", "+919876543210"],
  ["address_line1", "Near Old Bus Stand"],
];

describe("parseApplicationFormData", () => {
  it("trims text, maps checkboxes, and turns a blank optional field on the form into a clear (null)", () => {
    const raw = parseApplicationFormData(
      form([
        ...base,
        ["landmark", "   "],
        ["contact_email", ""],
        ["weekly_off_days", "tuesday"],
        ["weekly_off_days", "sunday"],
        ["operating_models", "pickup"],
        ["operating_models", "visit_only"],
        ["declaration_accepted", "on"],
      ]),
    );
    expect(raw.business_name).toBe("Sri Ram Kirana");
    expect(raw.landmark).toBeNull();
    expect(raw.contact_email).toBeNull();
    expect(raw.weekly_off_days).toEqual(["tuesday", "sunday"]);
    expect(raw.operating_models).toEqual(["pickup", "visit_only"]);
    expect(raw.declaration_accepted).toBe(true);
  });

  it("produces a valid submission end-to-end", () => {
    const raw = parseApplicationFormData(form([...base, ["operating_models", "visit_only"], ["declaration_accepted", "on"], ["pincode", "507001"], ["latitude", "17.2473"], ["longitude", "80.1514"]]));
    const parsed = submitApplicationInput.parse(raw);
    expect(parsed.latitude).toBeCloseTo(17.2473);
    expect(parsed.pincode).toBe("507001");
  });

  it("an unticked declaration is false and blocks submission but not drafts", () => {
    const raw = parseApplicationFormData(form([...base, ["operating_models", "visit_only"]]));
    expect(raw.declaration_accepted).toBe(false);
    expect(submitApplicationInput.safeParse(raw).success).toBe(false);
    expect(saveApplicationDraftInput.safeParse(raw).success).toBe(true);
  });

  it("ignores unknown option values and never reads status/review/file fields", () => {
    const raw = parseApplicationFormData(
      form([
        ...base,
        ["operating_models", "teleport"],
        ["weekly_off_days", "funday"],
        ["status", "approved"],
        ["reviewed_by", CATEGORY_ID],
        ["logo_storage_path", "someone-else/x.png"],
        ["applicant_user_id", CATEGORY_ID],
      ]),
    );
    expect(raw.operating_models).toEqual([]);
    expect(raw.weekly_off_days).toEqual([]);
    for (const key of ["status", "reviewed_by", "logo_storage_path", "applicant_user_id"]) expect(raw).not.toHaveProperty(key);
  });

  it("turns non-numeric coordinates into a validation failure rather than silently dropping them", () => {
    const raw = parseApplicationFormData(form([...base, ["latitude", "abc"], ["longitude", "80"]]));
    expect(saveApplicationDraftInput.safeParse(raw).success).toBe(false);
  });

  it("leaves a field that is not on the form untouched, so a partial form cannot erase stored data", () => {
    const raw = parseApplicationFormData(form(base));
    for (const key of ["landmark", "contact_email", "whatsapp_number", "pincode", "subcategory_id", "opening_time", "latitude"]) {
      expect(raw, key).not.toHaveProperty(key);
    }
  });

  it("emptying optional fields is a valid draft that clears them", () => {
    const raw = parseApplicationFormData(
      form([...base, ["operating_models", "visit_only"], ["whatsapp_number", ""], ["landmark", ""], ["pincode", ""], ["latitude", ""], ["longitude", ""], ["opening_time", ""], ["closing_time", ""], ["subcategory_id", ""], ["business_description", ""]]),
    );
    const parsed = saveApplicationDraftInput.parse(raw);
    for (const key of ["whatsapp_number", "landmark", "pincode", "latitude", "longitude", "opening_time", "closing_time", "subcategory_id", "business_description"] as const) {
      expect(parsed[key], key).toBeNull();
    }
  });

  it("clearing only one of opening/closing time (or latitude/longitude) is still refused", () => {
    expect(saveApplicationDraftInput.safeParse(parseApplicationFormData(form([...base, ["operating_models", "visit_only"], ["opening_time", "09:00"], ["closing_time", ""]]))).success).toBe(false);
    expect(saveApplicationDraftInput.safeParse(parseApplicationFormData(form([...base, ["operating_models", "visit_only"], ["latitude", "17.2"], ["longitude", ""]]))).success).toBe(false);
  });

  it("a chosen subcategory is carried as an id and a malformed one is refused", () => {
    const sub = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(saveApplicationDraftInput.parse(parseApplicationFormData(form([...base, ["operating_models", "visit_only"], ["subcategory_id", sub]]))).subcategory_id).toBe(sub);
    expect(saveApplicationDraftInput.safeParse(parseApplicationFormData(form([...base, ["operating_models", "visit_only"], ["subcategory_id", "not-an-id"]]))).success).toBe(false);
  });
});
