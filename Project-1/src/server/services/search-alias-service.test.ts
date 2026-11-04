import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { activeModules } from "./discovery-service";
import { addAliasInput, addSearchAlias, normaliseAliasWord, removeSearchAlias, setFlagInput, setModuleFlag } from "./search-alias-service";
import { ServiceError } from "./service-result";

function rpcClient(result: { data?: unknown; error?: { code: string; message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

describe("alias words", () => {
  it("are trimmed, collapsed and lower-cased exactly like the database does", () => {
    expect(normaliseAliasWord("  Beauty   PARLOUR ")).toBe("beauty parlour");
    expect(normaliseAliasWord("కిరాణా")).toBe("కిరాణా");
  });

  it("must be 2-60 characters and different from each other", () => {
    expect(addAliasInput.safeParse({ term: "a", alias: "bb" }).success).toBe(false);
    expect(addAliasInput.safeParse({ term: "ab", alias: "x".repeat(61) }).success).toBe(false);
    expect(addAliasInput.safeParse({ term: "Same", alias: " same " }).success).toBe(false);
    expect(addAliasInput.safeParse({ term: "laxmi", alias: "lakshmi" })).toMatchObject({ success: true, data: { both: true } });
  });
});

describe("addSearchAlias", () => {
  it("sends the normalised words and returns how many links were stored", async () => {
    const { db, rpc } = rpcClient({ data: 2 });
    await expect(addSearchAlias(db, { term: " Laxmi ", alias: "LAKSHMI", both: true })).resolves.toBe(2);
    expect(rpc).toHaveBeenCalledWith("admin_add_search_alias", { p_term: "laxmi", p_alias: "lakshmi", p_both: true });
  });

  it("does not touch the database when the input is invalid", async () => {
    const { db, rpc } = rpcClient({ data: 0 });
    await expect(addSearchAlias(db, { term: "x", alias: "y" })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the administrator the database's own validation message", async () => {
    const { db } = rpcClient({ error: { code: "23514", message: "the alias list is full (2000); remove some first" } });
    const err = await addSearchAlias(db, { term: "ab", alias: "cd" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).message).toContain("alias list is full");
  });

  it("tags an unexpected database error DATABASE_ERROR, which the server action replaces with a generic message", async () => {
    const { db } = rpcClient({ error: { code: "XX000", message: "internal detail" } });
    const err = await addSearchAlias(db, { term: "ab", alias: "cd" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("DATABASE_ERROR");
  });
});

describe("removeSearchAlias", () => {
  it("rejects a malformed id before calling the database", async () => {
    const { db, rpc } = rpcClient({ data: true });
    await expect(removeSearchAlias(db, "not-a-uuid")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports whether anything was removed", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    await expect(removeSearchAlias(rpcClient({ data: true }).db, id)).resolves.toBe(true);
    await expect(removeSearchAlias(rpcClient({ data: false }).db, id)).resolves.toBe(false);
  });
});

describe("module flags", () => {
  const area = "22222222-2222-4222-8222-222222222222";

  it("validates areas as UUIDs and caps the list", () => {
    expect(setFlagInput.safeParse({ key: "grocery", enabled: true, localities: ["nope"] }).success).toBe(false);
    expect(setFlagInput.safeParse({ key: "grocery", enabled: true, localities: [area] }).success).toBe(true);
    expect(setFlagInput.safeParse({ key: " ", enabled: true }).success).toBe(false);
  });

  it("passes the reason through and maps 'unknown module' to NOT_FOUND with a readable message", async () => {
    const ok = rpcClient({ data: "changed" });
    await expect(setModuleFlag(ok.db, { key: "grocery", enabled: true, localities: [area], reason: "pilot" })).resolves.toBe("changed");
    expect(ok.rpc).toHaveBeenCalledWith("admin_set_feature_flag", { p_key: "grocery", p_enabled: true, p_localities: [area], p_reason: "pilot" });

    const missing = rpcClient({ error: { code: "P0002", message: "unknown module flag" } });
    const err = await setModuleFlag(missing.db, { key: "zzz", enabled: true }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND", message: "unknown module flag" });
  });
});

describe("module gate rule (AC-19)", () => {
  const flag = (key: string, on: boolean, areas: string[] = []) => ({ key, is_enabled: on, enabled_localities: areas });
  it("an off module is off everywhere, an unknown module is off, a module limited to areas is off elsewhere and when the area is unknown", () => {
    const m = activeModules([flag("grocery", false), flag("shared_delivery", true, ["khammam"])], "khammam");
    expect(m["grocery"]).toBe(false);
    expect(m["shared_delivery"]).toBe(true);
    expect(m["never_registered"]).toBeUndefined(); // the gate treats undefined as off
    expect(activeModules([flag("shared_delivery", true, ["khammam"])], "elsewhere")["shared_delivery"]).toBe(false);
    expect(activeModules([flag("shared_delivery", true, ["khammam"])], null)["shared_delivery"]).toBe(false);
    expect(activeModules([flag("grocery", true)], null)["grocery"]).toBe(true);
  });
});
