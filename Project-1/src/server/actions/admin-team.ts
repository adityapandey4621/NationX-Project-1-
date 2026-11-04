"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { requireRole } from "../auth/session";
import { changeUserRole, ServiceError } from "../services";
import { createRequestClient } from "../supabase/server";
import { field } from "./shared";

const PATH = "/admin/team";

/** Grant or revoke the admin / operator role. Authorised again here (never trust the page) and again in SQL. */
export async function changeRoleAction(fd: FormData): Promise<never> {
  await requireRole("admin", PATH);
  let kind: "ok" | "error" = "ok";
  let msg = "Saved.";
  try {
    const grant = field(fd, "grant") === "true";
    const reason = field(fd, "reason");
    const result = await changeUserRole(await createRequestClient(), {
      email: field(fd, "email"),
      role: field(fd, "role") as "admin" | "operator",
      grant,
      ...(reason ? { reason } : {}),
    });
    msg = result === "unchanged" ? "No change: that person already had (or did not have) that role." : grant ? "Access granted." : "Access removed.";
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    msg =
      e instanceof ZodError
        ? (e.issues[0]?.message ?? "Please check the form.")
        : e instanceof ServiceError && e.code !== "DATABASE_ERROR"
          ? e.message
          : "That did not work. Please try again.";
    if (!(e instanceof ZodError) && !(e instanceof ServiceError)) console.error("Role change failed", e);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?${kind}=${encodeURIComponent(msg)}`);
}
