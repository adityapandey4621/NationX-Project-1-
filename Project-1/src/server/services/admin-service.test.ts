import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { adminOverviewSchema, changeUserRole, getAdminOverview, roleChangeInput } from "./admin-service";
import { ServiceError } from "./service-result";

const db = (result: { data?: unknown; error?: { code?: string; message: string } | null }) =>
  ({ rpc: async () => ({ data: result.data ?? null, error: result.error ?? null }) }) as unknown as SupabaseClient;

describe("roleChangeInput", () => {
  it("normalises the e-mail and accepts only admin or operator", () => {
    expect(roleChangeInput.parse({ email: "  Boss@Example.COM ", role: "admin", grant: true }).email).toBe("boss@example.com");
    expect(() => roleChangeInput.parse({ email: "boss@example.com", role: "merchant", grant: true })).toThrow();
    expect(() => roleChangeInput.parse({ email: "boss@example.com", role: "customer", grant: false })).toThrow();
  });
  it("rejects bad addresses and over-long notes", () => {
    expect(() => roleChangeInput.parse({ email: "not-an-email", role: "admin", grant: true })).toThrow(/e-mail/i);
    expect(() => roleChangeInput.parse({ email: `${"a".repeat(250)}@x.co`, role: "admin", grant: true })).toThrow();
    expect(() => roleChangeInput.parse({ email: "a@b.co", role: "admin", grant: true, reason: "x".repeat(501) })).toThrow();
  });
});

describe("changeUserRole", () => {
  const input = { email: "a@b.co", role: "operator" as const, grant: true };
  it("returns what the database decided", async () => {
    expect(await changeUserRole(db({ data: "granted" }), input)).toBe("granted");
    expect(await changeUserRole(db({ data: "unchanged" }), input)).toBe("unchanged");
  });
  it("keeps the database's readable sentence for an unknown e-mail and for rule violations", async () => {
    await expect(changeUserRole(db({ error: { code: "P0002", message: "no registered account with that e-mail; ask the person to sign up first" } }), input)).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("sign up first") });
    await expect(changeUserRole(db({ error: { code: "23514", message: "cannot remove the last administrator" } }), { ...input, role: "admin", grant: false })).rejects.toMatchObject({ code: "VALIDATION_ERROR", message: "cannot remove the last administrator" });
  });
  it("a non-admin gets a generic refusal, not the database text", async () => {
    const err = await changeUserRole(db({ error: { code: "42501", message: "administrator role required" } }), input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("FORBIDDEN");
    expect((err as ServiceError).message).toBe("You are not permitted to do that");
  });
  it("rejects an unexpected database answer", async () => {
    await expect(changeUserRole(db({ data: "banana" }), input)).rejects.toThrow();
  });
});

describe("getAdminOverview", () => {
  it("fills safe zeros when the database omits groups, and reads numbers sent as strings", async () => {
    const o = await getAdminOverview(db({ data: { generated_at: "2026-11-04T10:00:00Z", storefronts: { total: "3", live: 1, hidden: 1, suspended: 1, unpublished: 0 }, items: { total: 3, published: 2 }, waitlist_waiting: 4 } }));
    expect(o.storefronts.total).toBe(3);
    expect(o.applications).toEqual({});
    expect(o.by_area).toEqual([]);
    expect(o.waitlist_waiting).toBe(4);
  });
  it("parses area rows including empty areas", () => {
    const parsed = adminOverviewSchema.parse({
      generated_at: "x", storefronts: {}, items: {},
      by_area: [{ id: "a", name: "Gandhi Chowk", is_active: true, live: 0, hidden: 0, suspended: 0, items: 0, waiting: 2 }],
    });
    expect(parsed.by_area[0]).toMatchObject({ name: "Gandhi Chowk", live: 0, waiting: 2 });
  });
  it("surfaces a database refusal", async () => {
    await expect(getAdminOverview(db({ error: { code: "42501", message: "administrator role required" } }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
