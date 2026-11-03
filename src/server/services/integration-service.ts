import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createServiceClientInput,
  integrationEventSchema,
  serviceClientSchema,
  shopReferenceSchema,
  type CreateServiceClientInput,
  type IntegrationEvent,
  type ServiceClient,
  type ServiceScope,
  type ShopReference,
} from "../validation";
import { fromPostgrest, ServiceError } from "./service-result";

export const KEY_PREFIX = "nxsk_";
/** A key is `nxsk_` + 43 url-safe characters (256 random bits). */
const KEY_RE = /^nxsk_[A-Za-z0-9_-]{43}$/;

/** SHA-256 hex of the full key. Keys are high-entropy random values, so a plain hash is appropriate (no password stretching needed). */
export function hashServiceKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateServiceKey(): { key: string; prefix: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 4), hash: hashServiceKey(key) };
}

/** The key from `Authorization: Bearer nxsk_...`, or null when absent or malformed (so junk never reaches the database). */
export function extractServiceKey(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m?.[1] && KEY_RE.test(m[1]) ? m[1] : null;
}

/** Creates a client and returns its key ONCE. Only the hash is stored. `db` is the admin's own session client. */
export async function createServiceClient(db: SupabaseClient, raw: unknown): Promise<{ client: ServiceClient; key: string }> {
  const input: CreateServiceClientInput = createServiceClientInput.parse(raw);
  const { key, prefix, hash } = generateServiceKey();
  const { data, error } = await db.rpc("create_service_client", { p_name: input.name, p_key_prefix: prefix, p_key_hash: hash, p_scopes: input.scopes });
  if (error) throw fromPostgrest(error, "createServiceClient");
  const id = z.uuid().parse(data);
  const clients = await listServiceClients(db);
  const client = clients.find((c) => c.id === id);
  if (!client) throw new ServiceError("DATABASE_ERROR", "Service client was created but could not be read back");
  return { client, key };
}

export async function listServiceClients(db: SupabaseClient): Promise<ServiceClient[]> {
  const { data, error } = await db
    .from("service_clients")
    .select("id, name, key_prefix, scopes, is_active, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw fromPostgrest(error, "listServiceClients");
  return z.array(serviceClientSchema).parse(data);
}

export async function revokeServiceClient(db: SupabaseClient, id: string, reason?: string): Promise<{ revoked: boolean }> {
  const { data, error } = await db.rpc("revoke_service_client", { p_id: id, p_reason: reason ?? null });
  if (error) throw fromPostgrest(error, "revokeServiceClient");
  return { revoked: data === true };
}

export interface VerifiedClient {
  id: string;
  name: string;
  scopes: ServiceScope[];
}

/** Looks a key up with the SERVICE-ROLE client (the function is not callable by anyone else). Null when unknown or revoked. */
export async function verifyServiceKey(adminDb: SupabaseClient, key: string): Promise<VerifiedClient | null> {
  const { data, error } = await adminDb.rpc("verify_service_key", { p_key_hash: hashServiceKey(key) });
  if (error) throw fromPostgrest(error, "verifyServiceKey");
  const row = z.array(z.object({ client_id: z.uuid(), client_name: z.string(), scopes: z.array(z.string()) })).parse(data)[0];
  return row ? { id: row.client_id, name: row.client_name, scopes: row.scopes as ServiceScope[] } : null;
}

export interface EventPage {
  events: IntegrationEvent[];
  /** Pass as `after` next time. Equals the request's `after` when there was nothing new. */
  next_cursor: number;
  has_more: boolean;
}

export async function listEvents(adminDb: SupabaseClient, after: number, limit: number): Promise<EventPage> {
  // One extra row tells us whether more are waiting without a second query.
  const { data, error } = await adminDb.rpc("events_since", { p_after: after, p_limit: limit + 1 });
  if (error) throw fromPostgrest(error, "listEvents");
  const rows = z.array(integrationEventSchema).parse(data);
  const events = rows.slice(0, limit);
  return { events, next_cursor: events.at(-1)?.seq ?? after, has_more: rows.length > limit };
}

export interface ShopPage {
  shops: ShopReference[];
  next_cursor: string | null;
}

export async function listShopReferences(
  adminDb: SupabaseClient,
  opts: { after?: string | undefined; limit: number; locality?: string | undefined },
): Promise<ShopPage> {
  const { data, error } = await adminDb.rpc("integration_shops", {
    p_after: opts.after ?? null,
    p_limit: opts.limit + 1,
    p_locality_slug: opts.locality ?? null,
    p_shop_id: null,
  });
  if (error) throw fromPostgrest(error, "listShopReferences");
  const rows = z.array(shopReferenceSchema).parse(data);
  const shops = rows.slice(0, opts.limit);
  return { shops, next_cursor: rows.length > opts.limit ? (shops.at(-1)?.shop_id ?? null) : null };
}

export async function getShopReference(adminDb: SupabaseClient, shopId: string): Promise<ShopReference | null> {
  const { data, error } = await adminDb.rpc("integration_shops", { p_after: null, p_limit: 1, p_locality_slug: null, p_shop_id: shopId });
  if (error) throw fromPostgrest(error, "getShopReference");
  return z.array(shopReferenceSchema).parse(data)[0] ?? null;
}