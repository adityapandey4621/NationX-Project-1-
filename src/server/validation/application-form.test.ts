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
  it("trims text, drops blank inputs and maps checkboxes", () => {
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
    expect(raw).not.toHaveProperty("landmark");
    expect(raw).not.toHaveProperty("contact_email");
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
});
