import type { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import {
  approveApplication,
  assertOwnStoragePaths,
  attachApplicationFile,
  createApplicationDraft,
  listApplicationsForAdmin,
  rejectApplication,
  requestApplicationCorrections,
  submitApplication,
  updateApplicationDraft,
} from "./application-service";
import { fromPostgrest, ServiceError } from "./service-result";

const USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER = "11111111-1111-4111-8111-111111111111";
const APP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CAT = "22222222-2222-4222-8222-222222222222";
const LOC = "33333333-3333-4333-8333-333333333333";
const TS = "2026-11-02T10:00:00+00:00";

const draftInput = {
  business_name: "Sri Ram Kirana",
  category_id: CAT,
  locality_id: LOC,
  contact_phone: "+919876543210",
  address_line1: "Near Old Bus Stand",
};

function appRow(overrides: Record<string, unknown> = {}) {
  return {
    id: APP, applicant_user_id: USER, business_name: "Sri Ram Kirana", category_id: CAT, subcategory_id: null,
    contact_phone: "+919876543210", contact_email: null, whatsapp_number: null, address_line1: "x", address_line2: null,
    locality_id: LOC, pincode: null, landmark: null, latitude: null, longitude: null, opening_time: null, closing_time: null,
    weekly_off_days: null, business_description: null, logo_storage_path: null, photos_storage_paths: null,
    document_storage_paths: null, operating_models: ["visit_only"], category_specific_data: {}, declaration_accepted: false,
    status: "draft", rejection_reason: null, correction_notes: null, reviewed_by: null, reviewed_at: null,
    associated_business_id: null, created_at: TS, updated_at: TS, category: { name: "Kirana", slug: "kirana" },
    locality: { name: "Gandhi Chowk", slug: "gandhi-chowk", pincode: "507001" }, ...overrides,
  };
}

const pgError = (code: string, message = "boom"): PostgrestError =>
  ({ code, message, details: "", hint: "", name: "PostgrestError" }) as PostgrestError;

describe("createApplicationDraft", () => {
  it("inserts as the caller with status draft, never trusting client-supplied ownership", async () => {
    const { db, calls } = fakeDb(() => ({ data: appRow(), error: null }));
    await createApplicationDraft(db, USER, { ...draftInput, applicant_user_id: OTHER, status: "approved" } as never);
    const row = opArgs(calls[0], "insert")?.[0] as Record<string, unknown>;
    expect(row.applicant_user_id).toBe(USER);
    expect(row.status).toBe("draft");
    expect(row).not.toHaveProperty("reviewed_by");
  });

  it("rejects invalid data before touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: appRow(), error: null }));
    await expect(createApplicationDraft(db, USER, { ...draftInput, contact_phone: "123" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("explains duplicate applications in plain language", async () => {
    const { db } = fakeDb(() => ({ data: null, error: pgError("23505", "duplicate key value violates uq_apps_open_per_applicant") }));
    const err = await createApplicationDraft(db, USER, draftInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("CONFLICT");
    expect((err as ServiceError).message).toMatch(/already have an open application/i);
  });

  it("refuses file references that are not in the caller's private folder", async () => {
    const { db, calls } = fakeDb(() => ({ data: appRow(), error: null }));
    await expect(createApplicationDraft(db, USER, { ...draftInput, logo_storage_path: `${OTHER}/a/logo.png` })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createApplicationDraft(db, USER, { ...draftInput, photos_storage_paths: [`${USER}/../${OTHER}/x.png`] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(calls).toHaveLength(0);
  });
});

describe("updateApplicationDraft", () => {
  it("scopes the update to the applicant and application", async () => {
    const { db, calls } = fakeDb(() => ({ data: appRow(), error: null }));
    await updateApplicationDraft(db, USER, APP, draftInput);
    const eqs = calls[0]?.ops.filter(([o]) => o === "eq").map(([, a]) => a);
    expect(eqs).toContainEqual(["id", APP]);
    expect(eqs).toContainEqual(["applicant_user_id", USER]);
  });

  it("reports a conflict when the row is no longer editable (RLS filtered it out)", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    await expect(updateApplicationDraft(db, USER, APP, draftInput)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("assertOwnStoragePaths", () => {
  it("accepts only paths under the user's folder", () => {
    expect(() => assertOwnStoragePaths(USER, { ...draftInput, logo_storage_path: `${USER}/${APP}/logo-1.png` })).not.toThrow();
    expect(() => assertOwnStoragePaths(USER, { ...draftInput, document_storage_paths: ["other/x.pdf"] })).toThrow();
  });
});

describe("workflow calls", () => {
  it("submit calls the database workflow function with only the application id", async () => {
    const { db, calls } = fakeDb(() => ({ data: { status: "submitted" }, error: null }));
    await submitApplication(db, APP);
    expect(calls[0]?.target).toBe("rpc:submit_merchant_application");
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_application_id: APP });
  });

  it("maps database refusals to domain errors", async () => {
    const forbidden = fakeDb(() => ({ data: null, error: pgError("42501") })).db;
    await expect(approveApplication(forbidden, APP)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const wrongState = fakeDb(() => ({ data: null, error: pgError("55000", "only submitted applications can be approved (status is draft)") })).db;
    await expect(approveApplication(wrongState, APP)).rejects.toMatchObject({ code: "CONFLICT" });
    const missing = fakeDb(() => ({ data: null, error: pgError("P0002") })).db;
    await expect(submitApplication(missing, APP)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("approve passes optional overrides and parses the result", async () => {
    const result = { application_id: APP, business_id: CAT, shop_id: LOC, storefront_id: OTHER, slug: "sri-ram-kirana-gandhi-chowk", owner_id: USER, already_approved: false };
    const { db, calls } = fakeDb(() => ({ data: result, error: null }));
    const out = await approveApplication(db, APP, { review_notes: "ok", custom_slug: "my-shop" });
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_application_id: APP, p_review_notes: "ok", p_category_id: null, p_custom_slug: "my-shop" });
    expect(out.slug).toBe("sri-ram-kirana-gandhi-chowk");
  });

  it("approve rejects a malformed custom slug before calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await expect(approveApplication(db, APP, { custom_slug: "Bad Slug!" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("reject and request-corrections require non-empty text before calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: {}, error: null }));
    await expect(rejectApplication(db, APP, "   ")).rejects.toThrow();
    await expect(requestApplicationCorrections(db, APP, "")).rejects.toThrow();
    expect(calls).toHaveLength(0);
    await rejectApplication(db, APP, "Cannot verify");
    await requestApplicationCorrections(db, APP, "Clearer photo please");
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_application_id: APP, p_decision: "reject", p_text: "Cannot verify" });
    expect(opArgs(calls[1], "rpc")?.[0]).toEqual({ p_application_id: APP, p_decision: "request_corrections", p_text: "Clearer photo please" });
  });
});

describe("listApplicationsForAdmin", () => {
  it("excludes drafts, applies the status filter and clamps paging", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await listApplicationsForAdmin(db, { status: "submitted", limit: 9999, offset: -5 });
    const ops = calls[0]?.ops ?? [];
    expect(ops).toContainEqual(["neq", ["status", "draft"]]);
    expect(ops).toContainEqual(["eq", ["status", "submitted"]]);
    expect(ops).toContainEqual(["range", [0, 99]]);
  });
});

describe("attachApplicationFile", () => {
  it("refuses to attach to an application that is no longer editable", async () => {
    const { db } = fakeDb(() => ({ data: appRow({ status: "submitted" }), error: null }));
    await expect(attachApplicationFile(db, USER, APP, "photo", `${USER}/${APP}/photo-1.png`)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses paths outside the application's folder", async () => {
    const { db } = fakeDb(() => ({ data: appRow(), error: null }));
    await expect(attachApplicationFile(db, USER, APP, "photo", `${OTHER}/${APP}/photo-1.png`)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("enforces the photo limit", async () => {
    const existing = Array.from({ length: 8 }, (_, i) => `${USER}/${APP}/photo-${i}.png`);
    const { db } = fakeDb(() => ({ data: appRow({ photos_storage_paths: existing }), error: null }));
    await expect(attachApplicationFile(db, USER, APP, "photo", `${USER}/${APP}/photo-9.png`)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("fromPostgrest", () => {
  it("maps both no_data_found (P0002, PL/pgSQL) and no_data (02000) to NOT_FOUND", () => {
    expect(fromPostgrest(pgError("P0002", "application not found"), "ctx").code).toBe("NOT_FOUND");
    expect(fromPostgrest(pgError("02000"), "ctx").code).toBe("NOT_FOUND");
  });
  it("maps the help-request throttle to RATE_LIMITED", () => {
    expect(fromPostgrest(pgError("54000", "too many"), "ctx").code).toBe("RATE_LIMITED");
  });
  it("never leaks raw database messages for unexpected errors to users", () => {
    const e = fromPostgrest(pgError("XX000", "relation secret_table does not exist"), "ctx");
    expect(e.code).toBe("DATABASE_ERROR");
  });
  it("keeps deliberate workflow messages for validation failures", () => {
    expect(fromPostgrest(pgError("23514", "the declaration must be accepted before submitting"), "ctx")).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "the declaration must be accepted before submitting",
    });
  });
  it("describes slug conflicts but hides other unique violations", () => {
    expect(fromPostgrest(pgError("23505", 'slug "x" is already taken'), "ctx").message).toMatch(/already taken/);
    expect(fromPostgrest(pgError("23505", "duplicate key value violates unique constraint foo"), "ctx").message).toBe("That record already exists");
  });
});
