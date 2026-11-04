import { describe, expect, it } from "vitest";
import {
  APPLICATION_STATUSES,
  phoneSchema,
  recordAuditInput,
  saveApplicationDraftInput,
  slugSchema,
  submitApplicationInput,
  updateShopDetailsInput,
} from "./index";

const CATEGORY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const LOCALITY_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const validSubmission = {
  business_name: "Test Business",
  category_id: CATEGORY_ID,
  locality_id: LOCALITY_ID,
  contact_phone: "+919876543210",
  address_line1: "Test address",
  declaration_accepted: true as const,
};

describe("common schemas", () => {
  it("accepts Indian mobile numbers in +91 format only", () => {
    expect(phoneSchema.safeParse("+919876543210").success).toBe(true);
    expect(phoneSchema.safeParse("9876543210").success).toBe(false);
    expect(phoneSchema.safeParse("+911234567890").success).toBe(false);
  });

  it("requires lowercase kebab-case slugs", () => {
    expect(slugSchema.safeParse("sri-lakshmi-kirana-khammam").success).toBe(true);
    expect(slugSchema.safeParse("Sri Lakshmi").success).toBe(false);
    expect(slugSchema.safeParse("double--dash").success).toBe(false);
  });
});

describe("merchant application inputs", () => {
  it("accepts a complete submission and defaults operating models", () => {
    const parsed = submitApplicationInput.parse(validSubmission);
    expect(parsed.operating_models).toEqual(["visit_only"]);
  });

  it("rejects submission without the declaration", () => {
    expect(submitApplicationInput.safeParse({ ...validSubmission, declaration_accepted: false }).success).toBe(false);
  });

  it("does not let applicants supply status or review fields", () => {
    const parsed = submitApplicationInput.parse({
      ...validSubmission,
      status: "approved",
      reviewed_by: CATEGORY_ID,
    });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("reviewed_by");
  });

  it("rejects latitude without longitude", () => {
    expect(submitApplicationInput.safeParse({ ...validSubmission, latitude: 17.25 }).success).toBe(false);
  });

  it("allows a partial draft but requires the NOT NULL columns", () => {
    const base = {
      business_name: "X",
      category_id: CATEGORY_ID,
      locality_id: LOCALITY_ID,
      contact_phone: "+919876543210",
      address_line1: "Main road",
    };
    expect(saveApplicationDraftInput.safeParse(base).success).toBe(true);
    expect(saveApplicationDraftInput.safeParse({ business_name: "X" }).success).toBe(false);
    const { address_line1: _omit, ...withoutAddress } = base;
    void _omit;
    expect(saveApplicationDraftInput.safeParse(withoutAddress).success).toBe(false);
  });

  it("requires opening and closing time together", () => {
    expect(submitApplicationInput.safeParse({ ...validSubmission, opening_time: "09:00" }).success).toBe(false);
    expect(submitApplicationInput.safeParse({ ...validSubmission, opening_time: "09:00", closing_time: "21:00" }).success).toBe(true);
  });

  it("validates PIN codes and weekday names", () => {
    expect(submitApplicationInput.safeParse({ ...validSubmission, pincode: "507001" }).success).toBe(true);
    expect(submitApplicationInput.safeParse({ ...validSubmission, pincode: "012345" }).success).toBe(false);
    expect(submitApplicationInput.safeParse({ ...validSubmission, pincode: "5070" }).success).toBe(false);
    expect(submitApplicationInput.safeParse({ ...validSubmission, weekly_off_days: ["tuesday"] }).success).toBe(true);
    expect(submitApplicationInput.safeParse({ ...validSubmission, weekly_off_days: ["Funday"] }).success).toBe(false);
  });

  it("mirrors the database status CHECK constraint", () => {
    expect(APPLICATION_STATUSES).toEqual([
      "draft",
      "submitted",
      "correction_requested",
      "approved",
      "rejected",
      "suspended",
    ]);
  });
});

describe("merchant storefront updates", () => {
  it("excludes platform-controlled fields", () => {
    const parsed = updateShopDetailsInput.parse({ phone: "+919876543210", slug: "x", ordering_enabled: true });
    expect(parsed).toEqual({ phone: "+919876543210" });
  });
});

describe("audit input", () => {
  it("requires a UUID entity id", () => {
    expect(
      recordAuditInput.safeParse({ actor_id: null, action: "approve", entity_type: "shop", entity_id: "nope" }).success,
    ).toBe(false);
  });
});
