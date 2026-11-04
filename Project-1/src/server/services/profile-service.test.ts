import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getProfile, getUserRoles, updateOwnProfile } from "./profile-service";
import { ServiceError } from "./service-result";

const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const profileRow = {
  id: USER_ID,
  full_name: "Asha Rao",
  phone: "+919876543210",
  email: "asha@example.com",
  preferred_language: "en",
  is_active: true,
  created_at: "2026-11-02T10:00:00+00:00",
  updated_at: "2026-11-02T10:00:00+00:00",
};

/** Chainable stand-in for the PostgREST builder; records calls, resolves to `result`. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update", "from"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return { db: builder as unknown as SupabaseClient, calls };
}

describe("profile-service", () => {
  it("getProfile parses the row, returns null when absent", async () => {
    expect((await getProfile(fakeDb({ data: profileRow, error: null }).db, USER_ID))?.full_name).toBe("Asha Rao");
    expect(await getProfile(fakeDb({ data: null, error: null }).db, USER_ID)).toBeNull();
  });

  it("getProfile rejects a non-UUID id before querying", async () => {
    const { db, calls } = fakeDb({ data: null, error: null });
    await expect(getProfile(db, "1; drop table profiles")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("getUserRoles returns role names and rejects unknown roles", async () => {
    expect(await getUserRoles(fakeDb({ data: [{ role: "customer" }, { role: "admin" }], error: null }).db, USER_ID)).toEqual([
      "customer",
      "admin",
    ]);
    await expect(getUserRoles(fakeDb({ data: [{ role: "superuser" }], error: null }).db, USER_ID)).rejects.toThrow();
  });

  it("updateOwnProfile scopes the write to the caller and never sends privileged columns", async () => {
    const { db, calls } = fakeDb({ data: { ...profileRow, full_name: "New" }, error: null });
    await updateOwnProfile(db, USER_ID, { full_name: "New", is_active: false, role: "admin" } as never);
    const update = calls.find(([m]) => m === "update");
    expect(update?.[1][0]).toEqual({ full_name: "New" });
    expect(calls.find(([m]) => m === "eq")?.[1]).toEqual(["id", USER_ID]);
  });

  it("updateOwnProfile maps a unique violation to CONFLICT and no row to NOT_FOUND", async () => {
    const dup = fakeDb({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(updateOwnProfile(dup.db, USER_ID, { phone: "+919876543210" })).rejects.toMatchObject({ code: "CONFLICT" });
    const none = fakeDb({ data: null, error: null });
    const err = await updateOwnProfile(none.db, USER_ID, { full_name: "X" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("NOT_FOUND");
  });
});
