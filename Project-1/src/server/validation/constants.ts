/**
 * Plain value lists with NO imports.
 *
 * Client components (merchant forms) need these lists at runtime. Importing them from
 * `@/server/validation` (the barrel) pulls every Zod schema into the browser bundle, which
 * pushed the merchant screens over the 150 kB first-load budget (NFR-01). Client code must
 * import from here; the schemas in `enums.ts` / `merchant-application.ts` re-use these lists so
 * there is still one source of truth.
 */

export const OPERATING_MODELS = [
  "delivery",
  "pickup",
  "visit_only",
  "appointment",
  "quotation",
] as const;

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

export const STOCK_STATUSES = ["in_stock", "call_to_confirm", "out_of_stock"] as const;
