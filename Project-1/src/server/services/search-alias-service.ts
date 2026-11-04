import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fromPostgrest, ServiceError } from "./service-result";

/** One word the search treats as another (migration 018). Administrator-only; written by audited SQL functions. */
export const searchAliasSchema = z.object({ id: z.string(), term: z.string(), alias: z.string(), created_at: z.string() });
export type SearchAlias = z.infer<typeof searchAliasSchema>;

/** Collapse whitespace and lower-case, exactly as the database does, so the form shows what will be stored. */
export function normaliseAliasWord(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

export const addAliasInput = z
  .object({
    term: z.string().transform(normaliseAliasWord).pipe(z.string().min(2, "Enter the word customers might type (at least 2 characters)").max(60, "Keep each word under 60 characters")),
    alias: z.string().transform(normaliseAliasWord).pipe(z.string().min(2, "Enter the other spelling (at least 2 characters)").max(60, "Keep each word under 60 characters")),
    both: z.boolean().default(true),
  })
  .refine((v) => v.term !== v.alias, { message: "The two words are the same", path: ["alias"] });
export type AddAliasInput = z.input<typeof addAliasInput>;

export async function listSearchAliases(db: SupabaseClient, limit = 500): Promise<SearchAlias[]> {
  const { data, error } = await db
    .from("search_aliases")
    .select("id, term, alias, created_at")
    .order("term", { ascending: true })
    .order("alias", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 2000));
  if (error) throw fromPostgrest(error, "listSearchAliases");
  return z.array(searchAliasSchema).parse(data);
}

/** Returns how many pairs were stored (0 if they already existed). The database re-indexes affected shops. */
export async function addSearchAlias(db: SupabaseClient, input: AddAliasInput): Promise<number> {
  const v = addAliasInput.parse(input);
  const { data, error } = await db.rpc("admin_add_search_alias", { p_term: v.term, p_alias: v.alias, p_both: v.both });
  if (error) {
    // Written for the administrator to read; the generic mapper would replace check_violation text.
    if (error.code === "23514") throw new ServiceError("VALIDATION_ERROR", error.message, error);
    throw fromPostgrest(error, "addSearchAlias");
  }
  return z.coerce.number().parse(data);
}

export async function removeSearchAlias(db: SupabaseClient, id: string): Promise<boolean> {
  const uuid = z.uuid("That entry no longer exists").parse(id);
  const { data, error } = await db.rpc("admin_remove_search_alias", { p_id: uuid });
  if (error) throw fromPostgrest(error, "removeSearchAlias");
  return z.boolean().parse(data);
}

/** A module switch (migration 018 seeds `grocery` and `shared_delivery`, both off). */
export const moduleFlagSchema = z.object({
  key: z.string(),
  description: z.string().nullable(),
  is_enabled: z.boolean(),
  enabled_localities: z.array(z.string()),
  updated_at: z.string(),
});
export type ModuleFlag = z.infer<typeof moduleFlagSchema>;

export async function listModuleFlags(db: SupabaseClient): Promise<ModuleFlag[]> {
  const { data, error } = await db
    .from("feature_flags")
    .select("key, description, is_enabled, enabled_localities, updated_at")
    .order("key", { ascending: true });
  if (error) throw fromPostgrest(error, "listModuleFlags");
  return z.array(moduleFlagSchema).parse(data);
}

export const setFlagInput = z.object({
  key: z.string().trim().min(1, "Choose a module").max(60),
  enabled: z.boolean(),
  localities: z.array(z.uuid("Choose areas from the list")).max(200).default([]),
  reason: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
});
export type SetFlagInput = z.input<typeof setFlagInput>;

export async function setModuleFlag(db: SupabaseClient, input: SetFlagInput): Promise<"changed" | "unchanged"> {
  const v = setFlagInput.parse(input);
  const { data, error } = await db.rpc("admin_set_feature_flag", {
    p_key: v.key,
    p_enabled: v.enabled,
    p_localities: v.localities,
    p_reason: v.reason ?? null,
  });
  if (error) {
    if (error.code === "P0002" || error.code === "23514") throw new ServiceError(error.code === "P0002" ? "NOT_FOUND" : "VALIDATION_ERROR", error.message, error);
    throw fromPostgrest(error, "setModuleFlag");
  }
  return z.enum(["changed", "unchanged"]).parse(data);
}
