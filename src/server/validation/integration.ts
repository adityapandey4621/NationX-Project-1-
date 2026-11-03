import { z } from "zod";
import { latitudeSchema, longitudeSchema, slugSchema, timestampSchema, uuidSchema } from "./common";

/** What a service client may do. Add a scope here AND in the SQL CHECK (migration 011) together. */
export const SERVICE_SCOPES = ["events:read", "reference:read"] as const;
export const serviceScopeSchema = z.enum(SERVICE_SCOPES);
export type ServiceScope = z.infer<typeof serviceScopeSchema>;

export const createServiceClientInput = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(serviceScopeSchema).min(1).max(SERVICE_SCOPES.length).transform((s) => [...new Set(s)]),
});
export type CreateServiceClientInput = z.infer<typeof createServiceClientInput>;

/** A client as shown to admins. The key and its hash are never part of this. */
export const serviceClientSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  key_prefix: z.string(),
  scopes: z.array(serviceScopeSchema),
  is_active: z.boolean(),
  created_at: timestampSchema,
  last_used_at: timestampSchema.nullable(),
  revoked_at: timestampSchema.nullable(),
});
export type ServiceClient = z.infer<typeof serviceClientSchema>;

export const EVENT_TYPES = [
  "storefront.created",
  "storefront.published",
  "storefront.unpublished",
  "storefront.visibility_changed",
  "storefront.ordering_changed",
  "shop.updated",
] as const;

export const integrationEventSchema = z.object({
  seq: z.coerce.number().int(),
  event_id: uuidSchema,
  event_type: z.string(),
  entity_type: z.string(),
  entity_id: uuidSchema,
  payload: z.record(z.string(), z.unknown()),
  occurred_at: timestampSchema,
});
export type IntegrationEvent = z.infer<typeof integrationEventSchema>;

export const eventsQuery = z.object({
  after: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)),
  limit: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(500).default(100)),
});

export const shopsQuery = z.object({
  after: z.preprocess((v) => (v === "" || v === null ? undefined : v), uuidSchema.optional()),
  limit: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).max(200).default(100)),
  locality: z.preprocess((v) => (v === "" || v === null ? undefined : v), slugSchema.optional()),
});

export const shopReferenceSchema = z.object({
  shop_id: uuidSchema,
  business_id: uuidSchema,
  storefront_id: uuidSchema,
  slug: slugSchema,
  name: z.string(),
  category_id: uuidSchema,
  category_slug: z.string(),
  category_name: z.string(),
  locality_id: uuidSchema,
  locality_slug: z.string(),
  locality_name: z.string(),
  address_line: z.string(),
  pincode: z.string().nullable(),
  latitude: z.coerce.number().pipe(latitudeSchema).nullable().catch(null),
  longitude: z.coerce.number().pipe(longitudeSchema).nullable().catch(null),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  operating_models: z.array(z.string()),
  operating_hours: z.unknown().nullable(),
  ordering_enabled: z.boolean(),
  template_name: z.string(),
  updated_at: timestampSchema,
});
export type ShopReference = z.infer<typeof shopReferenceSchema>;