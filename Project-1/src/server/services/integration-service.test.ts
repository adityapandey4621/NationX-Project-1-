import { describe, expect, it } from "vitest";
import {
  KEY_PREFIX,
  createServiceClient,
  extractServiceKey,
  generateServiceKey,
  hashServiceKey,
  listEvents,
  listShopReferences,
  verifyServiceKey,
} from "./integration-service";
import { fakeDb, opArgs } from "../../test/fake-db";

describe("service keys", () => {
  it("generates a prefixed 256-bit key whose hash is stored, not the key", () => {
    const { key, prefix, hash } = generateServiceKey();
    expect(key).toMatch(/^nxsk_[A-Za-z0-9_-]{43}$/);
    expect(prefix).toBe(key.slice(0, KEY_PREFIX.length + 4));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashServiceKey(key));
    expect(hash).not.toContain(key);
  });
  it("never repeats", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateServiceKey().key)).size).toBe(50);
  });
  it("hashes deterministically and differently per key", () => {
    expect(hashServiceKey("a")).toBe(hashServiceKey("a"));
    expect(hashServiceKey("a")).not.toBe(hashServiceKey("b"));
  });
});

describe("extractServiceKey", () => {
  const good = generateServiceKey().key;
  it("accepts a bearer key", () => expect(extractServiceKey(`Bearer ${good}`)).toBe(good));
  it("is case-insensitive about the scheme", () => expect(extractServiceKey(`bearer ${good}`)).toBe(good));
  it.each([null, "", "Basic abc", "Bearer", "Bearer nxsk_short", `Bearer ${good}x`, `Bearer ${good} extra`, "Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig"])(
    "rejects %s without touching the database",
    (h) => expect(extractServiceKey(h as string | null)).toBeNull(),
  );
});

describe("createServiceClient", () => {
  it("validates before calling the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await expect(createServiceClient(db, { name: "x", scopes: ["events:read"] })).rejects.toThrow();
    await expect(createServiceClient(db, { name: "Grocery", scopes: [] })).rejects.toThrow();
    await expect(createServiceClient(db, { name: "Grocery", scopes: ["admin:all"] })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("sends only the hash and prefix to the database and returns the key once", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const { db, calls } = fakeDb((c) =>
      c.target === "rpc:create_service_client"
        ? { data: id, error: null }
        : { data: [{ id, name: "Grocery", key_prefix: "nxsk_abcd", scopes: ["events:read"], is_active: true, created_at: "2026-11-03T00:00:00Z", last_used_at: null, revoked_at: null }], error: null },
    );
    const out = await createServiceClient(db, { name: " Grocery ", scopes: ["events:read", "events:read"] });
    const args = opArgs(calls[0], "rpc")?.[0] as Record<string, unknown>;
    expect(args.p_name).toBe("Grocery");
    expect(args.p_scopes).toEqual(["events:read"]);
    expect(args.p_key_hash).toBe(hashServiceKey(out.key));
    expect(JSON.stringify(args)).not.toContain(out.key);
    expect(out.client.id).toBe(id);
  });
});

describe("verifyServiceKey", () => {
  it("looks up by hash and returns the client", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ client_id: "11111111-1111-4111-8111-111111111111", client_name: "G", scopes: ["events:read"] }], error: null }));
    const out = await verifyServiceKey(db, "nxsk_" + "a".repeat(43));
    expect(out).toEqual({ id: "11111111-1111-4111-8111-111111111111", name: "G", scopes: ["events:read"] });
    expect((opArgs(calls[0], "rpc")?.[0] as { p_key_hash: string }).p_key_hash).toBe(hashServiceKey("nxsk_" + "a".repeat(43)));
  });
  it("returns null for an unknown or revoked key", async () => {
    const { db } = fakeDb(() => ({ data: [], error: null }));
    expect(await verifyServiceKey(db, "nxsk_" + "b".repeat(43))).toBeNull();
  });
});

const ev = (seq: number, extra: Record<string, unknown> = {}) => ({ seq, event_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, event_type: "storefront.published", schema_version: 1, entity_type: "storefront", entity_id: "11111111-1111-4111-8111-111111111111", payload: {}, occurred_at: "2026-11-03T00:00:00Z", ...extra });

/** Answers the feed and the retention marker separately, as the real database does. */
const feedDb = (rows: unknown[], purgedThrough: number | null = 0) =>
  fakeDb((call) => (call.target === "rpc:event_outbox_purged_through" ? { data: purgedThrough, error: null } : { data: rows, error: null }));

describe("listEvents", () => {
  it("asks for one extra row to learn whether more exist, and reports the cursor", async () => {
    const { db, calls } = feedDb([ev(5), ev(6), ev(7)]);
    const page = await listEvents(db, 4, 2);
    expect(opArgs(calls.find((c) => c.target === "rpc:events_since"), "rpc")?.[0]).toEqual({ p_after: 4, p_limit: 3 });
    expect(page.events.map((e) => e.seq)).toEqual([5, 6]);
    expect(page.next_cursor).toBe(6);
    expect(page.has_more).toBe(true);
  });
  it("keeps the cursor where it was when nothing is new", async () => {
    const { db } = feedDb([]);
    expect(await listEvents(db, 9, 100)).toEqual({ events: [], next_cursor: 9, has_more: false, purged_through: 0, gap: false });
  });
  it("passes the payload version through to the consumer", async () => {
    const { db } = feedDb([ev(5, { schema_version: 2 })]);
    expect((await listEvents(db, 4, 10)).events[0]?.schema_version).toBe(2);
  });
  it("refuses a feed row without a valid payload version rather than guessing one", async () => {
    const { db } = feedDb([ev(5, { schema_version: 0 })]);
    await expect(listEvents(db, 4, 10)).rejects.toThrow();
  });
  it("flags a gap when the caller's cursor is behind events that retention removed", async () => {
    const { db } = feedDb([ev(60)], 50);
    const page = await listEvents(db, 10, 10);
    expect(page.gap).toBe(true);
    expect(page.purged_through).toBe(50);
  });
  it("reports no gap when the cursor is at or past the purge point, or nothing was ever purged", async () => {
    expect((await listEvents(feedDb([ev(60)], 50).db, 50, 10)).gap).toBe(false);
    expect((await listEvents(feedDb([ev(60)], 50).db, 70, 10)).gap).toBe(false);
    expect((await listEvents(feedDb([ev(1)], 0).db, 0, 10)).gap).toBe(false);
  });
  it("treats a missing purge marker as nothing purged", async () => {
    expect((await listEvents(feedDb([], null).db, 0, 10)).purged_through).toBe(0);
  });
  it("surfaces a database error from either call", async () => {
    const failing = fakeDb((call) => (call.target === "rpc:event_outbox_purged_through" ? { data: null, error: { message: "boom", code: "XX000" } } : { data: [], error: null }));
    await expect(listEvents(failing.db, 0, 10)).rejects.toBeDefined();
  });
});

describe("listShopReferences", () => {
  it("passes keyset parameters and trims the lookahead row", async () => {
    const shop = (n: number) => ({
      shop_id: `00000000-0000-4000-8000-00000000000${n}`, business_id: "11111111-1111-4111-8111-111111111111", storefront_id: "22222222-2222-4222-8222-222222222222",
      slug: "s-" + n, name: "S", category_id: "33333333-3333-4333-8333-333333333333", category_slug: "kirana", category_name: "Kirana",
      locality_id: "44444444-4444-4444-8444-444444444444", locality_slug: "x", locality_name: "X", address_line: "a", pincode: null,
      latitude: "17.25", longitude: "80.15", phone: null, whatsapp: null, operating_models: [], operating_hours: null, ordering_enabled: false,
      template_name: "grocery", updated_at: "2026-11-03T00:00:00Z",
    });
    const { db, calls } = fakeDb(() => ({ data: [shop(1), shop(2), shop(3)], error: null }));
    const page = await listShopReferences(db, { limit: 2, locality: "x" });
    expect(opArgs(calls[0], "rpc")?.[0]).toMatchObject({ p_limit: 3, p_locality_slug: "x", p_after: null });
    expect(page.shops).toHaveLength(2);
    expect(page.next_cursor).toBe("00000000-0000-4000-8000-000000000002");
    expect(page.shops[0]?.latitude).toBe(17.25);
  });
});