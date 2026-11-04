import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import { lookupPincode, nearestPincodes } from "./geo-service";

const LOC = "33333333-3333-4333-8333-333333333333";

describe("lookupPincode", () => {
  it("returns null without querying for malformed PIN codes", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    for (const bad of ["12345", "0123456", "abcdef", "507 001", "' or 1=1 --"]) expect(await lookupPincode(db, bad)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("combines India Post offices with matching NationX localities", async () => {
    const { db } = fakeDb((c) =>
      c.target === "pincodes"
        ? { data: [{ pincode: "507001", office_name: "Khammam H.O", district: "Khammam", state: "Telangana" }], error: null }
        : { data: [{ id: LOC, name: "Gandhi Chowk", slug: "gandhi-chowk", district: "Khammam", state: "Telangana", pincode: "507001", is_active: true, created_at: "2026-11-02T10:00:00+00:00" }], error: null },
    );
    const r = await lookupPincode(db, "507001");
    expect(r).toMatchObject({ pincode: "507001", district: "Khammam", state: "Telangana", offices: ["Khammam H.O"] });
    expect(r?.localities.map((l) => l.slug)).toEqual(["gandhi-chowk"]);
  });

  it("falls back to the locality's district when the directory has not been imported", async () => {
    const { db } = fakeDb((c) =>
      c.target === "pincodes"
        ? { data: [], error: null }
        : { data: [{ id: LOC, name: "Gandhi Chowk", slug: "gandhi-chowk", district: "Khammam", state: "Telangana", pincode: "507001", is_active: true, created_at: "2026-11-02T10:00:00+00:00" }], error: null },
    );
    expect((await lookupPincode(db, "507001"))?.district).toBe("Khammam");
  });

  it("returns null when the PIN code is unknown everywhere", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    expect(await lookupPincode(db, "507999")).toBeNull();
  });
});

describe("nearestPincodes", () => {
  it("rejects out-of-range coordinates without calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: [], error: null }));
    await expect(nearestPincodes(db, 95, 0)).rejects.toThrow();
    await expect(nearestPincodes(db, 0, 200)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("calls the SQL function and parses suggestions", async () => {
    const { db, calls } = fakeDb(() => ({
      data: [{ pincode: "507001", office_name: "Khammam H.O", district: "Khammam", state: "Telangana", distance_km: 0.4 }],
      error: null,
    }));
    const out = await nearestPincodes(db, 17.2473, 80.1514, 2);
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_lat: 17.2473, p_lng: 80.1514, p_limit: 2 });
    expect(out[0]?.pincode).toBe("507001");
  });
});
