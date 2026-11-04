import { describe, expect, it } from "vitest";
import type { CommunityStat } from "@/server/validation";
import { shopsLabel, summarizeCommunity } from "./community";

const stat = (o: Partial<CommunityStat> & { locality_slug: string }): CommunityStat => ({
  locality_name: o.locality_slug,
  shop_count: 0,
  joined_30d: 0,
  last_joined_at: null,
  ...o,
});

describe("summarizeCommunity", () => {
  it("reports exactly what was counted", () => {
    const s = summarizeCommunity([
      stat({ locality_slug: "a", shop_count: 4, joined_30d: 1, last_joined_at: "2026-10-30T00:00:00Z" }),
      stat({ locality_slug: "b", shop_count: 2, joined_30d: 2, last_joined_at: "2026-11-02T00:00:00Z" }),
      stat({ locality_slug: "c" }),
    ]);
    expect(s.totalShops).toBe(6);
    expect(s.joined30d).toBe(3);
  });
  it("orders areas by most recent activity and lists empty areas separately", () => {
    const s = summarizeCommunity([
      stat({ locality_slug: "a", shop_count: 1, joined_30d: 1, last_joined_at: "2026-10-01T00:00:00Z" }),
      stat({ locality_slug: "b", shop_count: 1, joined_30d: 1, last_joined_at: "2026-11-01T00:00:00Z" }),
      stat({ locality_slug: "c" }),
    ]);
    expect(s.recentAreas.map((a) => a.slug)).toEqual(["b", "a"]);
    expect(s.emptyAreas.map((a) => a.slug)).toEqual(["c"]);
  });
  it("is all zeros for no data, never invents a number", () => {
    expect(summarizeCommunity([])).toEqual({ totalShops: 0, joined30d: 0, recentAreas: [], emptyAreas: [] });
  });
});

describe("shopsLabel", () => {
  it("pluralises", () => {
    expect(shopsLabel(1)).toBe("1 shop");
    expect(shopsLabel(0)).toBe("0 shops");
    expect(shopsLabel(23)).toBe("23 shops");
  });
});