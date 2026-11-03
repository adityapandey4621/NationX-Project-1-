import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import {
  cancelMyHelpRequest,
  getHelpRequestForStaff,
  listHelpRequestsForStaff,
  listMyHelpRequests,
  submitHelpRequest,
  trackHelpRequest,
  updateHelpRequest,
} from "./help-request-service";
import { ServiceError } from "./service-result";

const USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const REQ = "0f8fad5b-d9cb-469f-a165-70867728950e";
const LOC = "33333333-3333-4333-8333-333333333333";
const TS = "2026-11-02T10:00:00+00:00";

const valid = {
  item_name: "Wood-pressed sesame oil",
  preferred_locality_id: LOC,
  contact_name: "Venkatesh",
  contact_phone: "+919848012345",
  consent_given: true as const,
};

const pgError = (code: string, message = "boom") => ({ code, message, details: "", hint: "" });

const requestRow = {
  id: REQ, tracking_id: "HMF-KHM-202611-0001", customer_user_id: USER, item_name: "Oil", item_description: null,
  preferred_locality_id: LOC, category_id: null, contact_name: "V", contact_phone: "+919848012345", contact_email: null,
  status: "pending", matched_shop_id: null, resolution_notes: null, operator_id: null, resolved_at: null,
  created_at: TS, updated_at: TS, locality: { name: "Gandhi Chowk" }, category: null, matched_shop: null,
};

describe("submitHelpRequest", () => {
  it("sends only validated fields to the database function", async () => {
    const { db, calls } = fakeDb(() => ({ data: { tracking_id: "HMF-KHM-202611-0001", status: "pending" }, error: null }));
    const out = await submitHelpRequest(db, { ...valid, item_name: "  Oil  ", status: "matched", customer_user_id: "x", matched_shop_id: "y" } as never);
    expect(out.tracking_id).toBe("HMF-KHM-202611-0001");
    const args = opArgs(calls[0], "rpc")?.[0] as Record<string, unknown>;
    expect(args).toMatchObject({ p_item_name: "Oil", p_locality_id: LOC, p_consent: true, p_contact_email: null, p_category_id: null });
    expect(Object.keys(args).sort()).toEqual(
      ["p_category_id", "p_consent", "p_contact_email", "p_contact_name", "p_contact_phone", "p_item_description", "p_item_name", "p_locality_id"],
    );
  });

  it("rejects invalid input before calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: {}, error: null }));
    for (const bad of [
      { ...valid, consent_given: false }, { ...valid, item_name: "a" }, { ...valid, item_name: "x".repeat(201) },
      { ...valid, contact_phone: "12345" }, { ...valid, contact_email: "nope" }, { ...valid, preferred_locality_id: "abc" },
      { ...valid, contact_name: "  " }, { ...valid, item_description: "d".repeat(1001) },
    ]) {
      await expect(submitHelpRequest(db, bad as never)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it("maps the throttle to RATE_LIMITED and validation failures to VALIDATION_ERROR", async () => {
    const limited = fakeDb(() => ({ data: null, error: pgError("54000", "too many requests from this number") })).db;
    await expect(submitHelpRequest(limited, valid)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const invalid = fakeDb(() => ({ data: null, error: pgError("23514", "choose a valid locality") })).db;
    await expect(submitHelpRequest(invalid, valid)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("trackHelpRequest", () => {
  it("normalises the tracking id and requires a valid phone", async () => {
    const { db, calls } = fakeDb(() => ({
      data: { tracking_id: "HMF-KHM-202611-0001", status: "pending", item_name: "Oil", created_at: TS, updated_at: TS, resolution_notes: null, matched_shop_slug: null },
      error: null,
    }));
    await trackHelpRequest(db, { tracking_id: " hmf-khm-202611-0001 ", contact_phone: "+919848012345" });
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_tracking_id: "HMF-KHM-202611-0001", p_phone: "+919848012345" });
    await expect(trackHelpRequest(db, { tracking_id: "bogus", contact_phone: "+919848012345" })).rejects.toThrow();
    await expect(trackHelpRequest(db, { tracking_id: "HMF-KHM-202611-0001", contact_phone: "1" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it("surfaces a wrong id/phone as NOT_FOUND only", async () => {
    const { db } = fakeDb(() => ({ data: null, error: pgError("P0002", "request not found") }));
    await expect(trackHelpRequest(db, { tracking_id: "HMF-KHM-202611-0001", contact_phone: "+919848012345" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("customer-owned requests", () => {
  it("lists only the given user's requests", async () => {
    const { db, calls } = fakeDb(() => ({ data: [requestRow], error: null }));
    const list = await listMyHelpRequests(db, USER);
    expect(list).toHaveLength(1);
    expect(calls[0]?.ops).toContainEqual(["eq", ["customer_user_id", USER]]);
  });
  it("rejects a non-UUID user id without querying", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await expect(listMyHelpRequests(db, "1 OR 1=1")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("cancel goes through the owner-checked database function", async () => {
    const { db, calls } = fakeDb(() => ({ data: { status: "cancelled" }, error: null }));
    await cancelMyHelpRequest(db, REQ);
    expect(calls[0]?.target).toBe("rpc:cancel_help_request");
    const notMine = fakeDb(() => ({ data: null, error: pgError("P0002") })).db;
    await expect(cancelMyHelpRequest(notMine, REQ)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const notAllowed = fakeDb(() => ({ data: null, error: pgError("42501") })).db;
    await expect(cancelMyHelpRequest(notAllowed, REQ)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("staff handling", () => {
  it("passes decision, note and shop slug to the database function", async () => {
    const { db, calls } = fakeDb(() => ({ data: {}, error: null }));
    await updateHelpRequest(db, REQ, { status: "matched", notes: " confirmed ", matched_shop_slug: "sri-ram-kirana" });
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_request_id: REQ, p_status: "matched", p_notes: "confirmed", p_matched_shop_slug: "sri-ram-kirana" });
  });
  it("rejects unknown statuses client-side (no automatic or invented states)", async () => {
    const { db, calls } = fakeDb(() => ({ data: {}, error: null }));
    await expect(updateHelpRequest(db, REQ, { status: "auto_matched" } as never)).rejects.toThrow();
    await expect(updateHelpRequest(db, REQ, { status: "pending" } as never)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("non-staff are refused by the database", async () => {
    const { db } = fakeDb(() => ({ data: null, error: pgError("42501") }));
    await expect(updateHelpRequest(db, REQ, { status: "under_review" })).rejects.toBeInstanceOf(ServiceError);
    await expect(updateHelpRequest(db, REQ, { status: "under_review" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("lists with clamped paging and optional status filter", async () => {
    const { db, calls } = fakeDb(() => ({ data: [requestRow], error: null }));
    await listHelpRequestsForStaff(db, { status: "pending", limit: 5000, offset: -3 });
    expect(calls[0]?.ops).toContainEqual(["eq", ["status", "pending"]]);
    expect(calls[0]?.ops).toContainEqual(["range", [0, 99]]);
  });
  it("returns null for a missing request", async () => {
    const { db } = fakeDb(() => ({ data: null, error: null }));
    expect(await getHelpRequestForStaff(db, REQ)).toBeNull();
  });
});
