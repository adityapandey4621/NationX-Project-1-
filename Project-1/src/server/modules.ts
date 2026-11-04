import "server-only";
import { notFound } from "next/navigation";
import { activeModules, listFeatureFlags } from "./services";
import { createRequestClient } from "./supabase/server";

/**
 * Server-side gate for a future module's pages and routes (AC-19): call this first in a module's page or route.
 * A module that is off, unknown, or off for this area is a real 404, so its existence is not revealed, and nothing
 * client-side can switch it on. Fails closed: if the flags cannot be read, the module is treated as off.
 */
export async function requireModule(key: string, localityId: string | null = null): Promise<void> {
  let on = false;
  try {
    on = activeModules(await listFeatureFlags(await createRequestClient()), localityId)[key] === true;
  } catch (e) {
    console.error("Module flag check failed; treating module as off", key, e);
  }
  if (!on) notFound();
}
