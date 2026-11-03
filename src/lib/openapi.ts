import { EVENT_TYPES, SERVICE_SCOPES } from "@/server/validation/integration";

const envelope = (data: object) => ({
  type: "object",
  required: ["success", "data", "meta"],
  properties: { success: { const: true }, data, meta: { $ref: "#/components/schemas/Meta" } },
});

const errorResponses = {
  "401": { description: "Missing, malformed, unknown or revoked key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "403": { description: "Key lacks the required scope", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "429": { description: "Rate limited; honour Retry-After", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

/** OpenAPI 3.1 description of the integration surface (contracts C1 and C6). Served at /api/v1/integration/openapi. */
export function buildOpenApi(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "NationX Foundation Integration API",
      version: "1.0.0",
      description:
        "Read-only reference data and a change feed for other NationX products (Grocery, Shared Delivery). Authenticate with a service key: `Authorization: Bearer nxsk_...`. Within v1 changes are additive only. Development sample listings are never exposed.",
    },
    servers: [{ url: origin }],
    security: [{ serviceKey: [] }],
    paths: {
      "/api/v1/integration/events": {
        get: {
          operationId: "listEvents",
          summary: "Change feed (at-least-once, ordered)",
          description:
            "Returns events after the cursor, ordered by `seq`. Persist `next_cursor` only after processing the page. Delivery is at-least-once: make handlers idempotent on `event_id`. Events from an unfinished database transaction are withheld, so a cursor never skips an event.",
          "x-required-scope": "events:read",
          parameters: [
            { name: "after", in: "query", schema: { type: "integer", minimum: 0, default: 0 }, description: "Last `seq` you processed" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          ],
          responses: {
            "200": { description: "A page of events", content: { "application/json": { schema: envelope({ $ref: "#/components/schemas/EventPage" }) } } },
            ...errorResponses,
          },
        },
      },
      "/api/v1/integration/shops": {
        get: {
          operationId: "listShops",
          summary: "Live shop references (keyset pagination)",
          "x-required-scope": "reference:read",
          parameters: [
            { name: "after", in: "query", schema: { type: "string", format: "uuid" }, description: "`next_cursor` from the previous page" },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
            { name: "locality", in: "query", schema: { type: "string" }, description: "Locality slug" },
          ],
          responses: {
            "200": { description: "A page of shops", content: { "application/json": { schema: envelope({ $ref: "#/components/schemas/ShopPage" }) } } },
            ...errorResponses,
          },
        },
      },
      "/api/v1/integration/shops/{shopId}": {
        get: {
          operationId: "getShop",
          summary: "One live shop reference",
          "x-required-scope": "reference:read",
          parameters: [{ name: "shopId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: {
            "200": { description: "The shop", content: { "application/json": { schema: envelope({ $ref: "#/components/schemas/Shop" }) } } },
            "404": { description: "Not a live shop", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            ...errorResponses,
          },
        },
      },
      "/api/v1/integration/feature-flags": {
        get: {
          operationId: "listFeatureFlags",
          summary: "Module feature flags (everything ships dark)",
          "x-required-scope": "reference:read",
          responses: {
            "200": { description: "Flags", content: { "application/json": { schema: envelope({ type: "object", properties: { flags: { type: "array", items: { $ref: "#/components/schemas/Flag" } } } }) } } },
            ...errorResponses,
          },
        },
      },
    },
    components: {
      securitySchemes: { serviceKey: { type: "http", scheme: "bearer", description: `Service key. Scopes: ${SERVICE_SCOPES.join(", ")}. Issued by a NationX admin (POST /api/v1/admin/service-clients).` } },
      schemas: {
        Meta: { type: "object", properties: { timestamp: { type: "string", format: "date-time" }, requestId: { type: "string" } } },
        Error: {
          type: "object",
          properties: {
            success: { const: false },
            error: { type: "object", properties: { code: { enum: ["VALIDATION_FAILED", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "INTERNAL_ERROR"] }, message: { type: "string" } } },
          },
        },
        Event: {
          type: "object",
          required: ["seq", "event_id", "event_type", "entity_type", "entity_id", "payload", "occurred_at"],
          properties: {
            seq: { type: "integer" },
            event_id: { type: "string", format: "uuid" },
            event_type: { enum: [...EVENT_TYPES] },
            entity_type: { enum: ["storefront", "shop"] },
            entity_id: { type: "string", format: "uuid" },
            payload: { type: "object", additionalProperties: true, description: "Reference ids, slugs and status only. Never contact details." },
            occurred_at: { type: "string", format: "date-time" },
          },
        },
        EventPage: {
          type: "object",
          required: ["events", "next_cursor", "has_more"],
          properties: { events: { type: "array", items: { $ref: "#/components/schemas/Event" } }, next_cursor: { type: "integer" }, has_more: { type: "boolean" } },
        },
        Shop: {
          type: "object",
          properties: {
            shop_id: { type: "string", format: "uuid" }, business_id: { type: "string", format: "uuid" }, storefront_id: { type: "string", format: "uuid" },
            slug: { type: "string" }, name: { type: "string" },
            category_id: { type: "string", format: "uuid" }, category_slug: { type: "string" }, category_name: { type: "string" },
            locality_id: { type: "string", format: "uuid" }, locality_slug: { type: "string" }, locality_name: { type: "string" },
            address_line: { type: "string" }, pincode: { type: ["string", "null"] },
            latitude: { type: ["number", "null"] }, longitude: { type: ["number", "null"] },
            phone: { type: ["string", "null"] }, whatsapp: { type: ["string", "null"] },
            operating_models: { type: "array", items: { type: "string" } }, operating_hours: {},
            ordering_enabled: { type: "boolean", description: "Admin-controlled; false until ordering is approved for the shop" },
            template_name: { type: "string" }, updated_at: { type: "string", format: "date-time" },
          },
        },
        ShopPage: { type: "object", properties: { shops: { type: "array", items: { $ref: "#/components/schemas/Shop" } }, next_cursor: { type: ["string", "null"], format: "uuid" } } },
        Flag: { type: "object", properties: { key: { type: "string" }, is_enabled: { type: "boolean" }, enabled_localities: { type: "array", items: { type: "string", format: "uuid" } } } },
      },
    },
  };
}