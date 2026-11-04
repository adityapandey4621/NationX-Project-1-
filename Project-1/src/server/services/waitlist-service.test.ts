import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import { DEMAND_DISPLAY_MIN, joinWaitlist, leaveWaitlist, setWaitlistStatus, visibleDemand } from "./waitlist-service";

const LOC = "11111111-1111-4111-8111-111111111111";
const base = { locality_id: LOC, contact_phone: "+919848012345", consent_given: true as const };

describe("joinWaitlist", () => {
  it("refuses without consent before touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: "joined", error: null }));
    await expect(joinWaitlist(db, { ...base, consent_given: false })).rejects.toThrow();
    await expect(joinWaitlist(db, { locality_id: LOC, contact_phone: "+919848012345" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it.each(["12345", "9848012345", "+911234567890", "+91 98480 12345"])("refuses the phone %s", async (p) => {
    const { db, calls } = fakeDb(() => ({ data: "joined", error: null }));
    await expect(joinWaitlist(db, { ...base, contact_phone: p })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("sends exactly the consented fields and returns the outcome", async () => {
    const { db, calls } = fakeDb(() => ({ data: "joined", error: null }));
    expect(await joinWaitlist(db, { ...base, contact_name: "Ravi" })).toBe("joined");
    expect(calls[0]?.target).toBe("rpc:join_area_waitlist");
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_locality_id: LOC, p_category_id: null, p_phone: "+919848012345", p_name: "Ravi", p_consent: true });
    const again = fakeDb(() => ({ data: "already_waiting", error: null }));
    expect(await joinWaitlist(again.db, base)).toBe("already_waiting");
  });
  it("maps the per-number limit to RATE_LIMITED", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { code: "54000", message: "limit", details: "", hint: "", name: "PostgrestError" } }));
    await expect(joinWaitlist(db, base)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("leaveWaitlist / setWaitlistStatus", () => {
  it("validates and reports whether anything was removed", async () => {
    const { db } = fakeDb(() => ({ data: true, error: null }));
    expect(await leaveWaitlist(db, { locality_id: LOC, contact_phone: "+919848012345" })).toBe(true);
    await expect(leaveWaitlist(db, { locality_id: LOC, contact_phone: "bad" })).rejects.toThrow();
  });
  it("only accepts the two known statuses", async () => {
    const { db, calls } = fakeDb(() => ({ data: true, error: null }));
    await expect(setWaitlistStatus(db, LOC, { status: "deleted" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(await setWaitlistStatus(db, LOC, { status: "contacted" })).toBe(true);
  });
});

describe("visibleDemand", () => {
  const row = (n: number, slug: string) => ({ locality_slug: slug, locality_name: slug, waiting: n });
  it("hides small counts, which are noise and easy to game", () => {
    expect(DEMAND_DISPLAY_MIN).toBe(3);
    expect(visibleDemand([row(1, "a"), row(2, "b"), row(3, "c"), row(9, "d")]).map((r) => r.locality_slug)).toEqual(["d", "c"]);
  });
  it("is empty when nobody is waiting", () => expect(visibleDemand([row(0, "a")])).toEqual([]));
});