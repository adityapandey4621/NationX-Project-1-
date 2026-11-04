"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { requireRole } from "../auth/session";
import { addSearchAlias, removeSearchAlias, ServiceError, setModuleFlag } from "../services";
import { createRequestClient } from "../supabase/server";
import { field } from "./shared";

/** Run an admin mutation: authorise again here (never trust the page), turn every failure into a readable message, redirect back. */
async function run(path: string, work: () => Promise<string>): Promise<never> {
  await requireRole("admin", path);
  let kind: "ok" | "error" = "ok";
  let msg = "Saved.";
  try {
    msg = await work();
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    msg =
      e instanceof ZodError
        ? (e.issues[0]?.message ?? "Please check the form.")
        : e instanceof ServiceError && e.code !== "DATABASE_ERROR"
          ? e.message
          : "That did not work. Please try again.";
    if (!(e instanceof ZodError) && !(e instanceof ServiceError)) console.error("Admin action failed", e);
  }
  revalidatePath(path);
  revalidatePath("/", "layout"); // search results and the homepage may change
  redirect(`${path}?${kind}=${encodeURIComponent(msg)}`);
}

export async function addAliasAction(fd: FormData): Promise<never> {
  return run("/admin/search", async () => {
    const added = await addSearchAlias(await createRequestClient(), { term: field(fd, "term"), alias: field(fd, "alias"), both: fd.get("both") === "on" });
    return added === 0 ? "No change: those words were already linked." : `Saved. Customers typing either word will now find the same shops (${added} link${added === 1 ? "" : "s"} added).`;
  });
}

export async function removeAliasAction(fd: FormData): Promise<never> {
  return run("/admin/search", async () => ((await removeSearchAlias(await createRequestClient(), field(fd, "id"))) ? "Removed." : "That link was already removed."));
}

export async function setModuleAction(fd: FormData): Promise<never> {
  return run("/admin/modules", async () => {
    const reason = field(fd, "reason");
    const result = await setModuleFlag(await createRequestClient(), {
      key: field(fd, "key"),
      enabled: field(fd, "enabled") === "true",
      localities: fd.getAll("localities").filter((x): x is string => typeof x === "string" && x !== ""),
      ...(reason ? { reason } : {}),
    });
    return result === "unchanged" ? "No change: that setting was already in place." : "Saved.";
  });
}
