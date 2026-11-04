import { describe, expect, it } from "vitest";
import { fakeDb, opArgs } from "../../test/fake-db";
import { getShopStats, recordStorefrontEvent, summarizeStats } from "./stats-service";

describe("recordStorefrontEvent", () => {
  it("validates the action before touching the database", async () => {
    const { db, calls } = fakeDb(() => ({ data: true, error: null }));
    await expect(recordStorefrontEvent(db, "x", { action: "purchase" })).rejects.toThrow();
    await expect(recordStorefrontEvent(db, "x", {})).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("sends only the slug and action (no visitor data) and reports whether it counted", async () => {
    const { db, calls } = fakeDb(() => ({ data: true, error: null }));
    expect(await recordStorefrontEvent(db, "kirana-1", { action: "call" })).toBe(true);
    expect(opArgs(calls[0], "rpc")?.[0]).toEqual({ p_slug: "kirana-1", p_action: "call" });
    const none = fakeDb(() => ({ data: false, error: null }));
    expect(await recordStorefrontEvent(none.db, "gone", { action: "view" })).toBe(false);
  });
});

describe("summarizeStats", () => {
  it("adds up what was counted and nothing else", () => {
    const s = summarizeStats(
      [
        { day: "2026-11-01", views: 10, calls: 2, whatsapp: 1, directions: 0 },
        { day: "2026-11-02", views: 5, calls: 0, whatsapp: 3, directions: 4 },
      ],
      30,
    );
    expect(s).toEqual({ days: 30, views: 15, calls: 2, whatsapp: 4, directions: 4, taps: 10 });
  });
  it("is all zeros with no rows", () => expect(summarizeStats([], 30)).toEqual({ days: 30, views: 0, calls: 0, whatsapp: 0, directions: 0, taps: 0 }));
});

describe("getShopStats", () => {
  it("queries the shop's rows and summarises them", async () => {
    const { db, calls } = fakeDb(() => ({ data: [{ day: "2026-11-02", views: "7", calls: 1, whatsapp: 0, directions: 0 }], error: null }));
    const s = await getShopStats(db, "11111111-1111-4111-8111-111111111111", 7);
    expect(calls[0]?.target).toBe("storefront_stats_daily");
    expect(s.views).toBe(7);
    expect(s.days).toBe(7);
  });
});