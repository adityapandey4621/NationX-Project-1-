import { WEEKDAYS } from "./merchant-application";
import { OPERATING_MODELS } from "./enums";

/** Unvalidated shape handed to the Zod schemas; keys with blank input are omitted. */
export type RawApplicationFields = Record<string, unknown>;

function text(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
}

function number(formData: FormData, key: string): number | undefined {
  const t = text(formData, key);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN; // NaN fails schema validation with a clear error
}

function many(formData: FormData, key: string, allowed: readonly string[]): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === "string" && allowed.includes(v));
}

/**
 * Browser form → application fields. Blank inputs are dropped (not sent as
 * ""), checkboxes become arrays/booleans, and only known option values pass.
 * File columns are intentionally not read here: uploads have their own action.
 */
export function parseApplicationFormData(formData: FormData): RawApplicationFields {
  const raw: RawApplicationFields = {
    business_name: text(formData, "business_name"),
    category_id: text(formData, "category_id"),
    contact_phone: text(formData, "contact_phone"),
    contact_email: text(formData, "contact_email"),
    whatsapp_number: text(formData, "whatsapp_number"),
    address_line1: text(formData, "address_line1"),
    address_line2: text(formData, "address_line2"),
    locality_id: text(formData, "locality_id"),
    pincode: text(formData, "pincode"),
    landmark: text(formData, "landmark"),
    latitude: number(formData, "latitude"),
    longitude: number(formData, "longitude"),
    opening_time: text(formData, "opening_time"),
    closing_time: text(formData, "closing_time"),
    weekly_off_days: many(formData, "weekly_off_days", WEEKDAYS),
    business_description: text(formData, "business_description"),
    operating_models: many(formData, "operating_models", OPERATING_MODELS),
    declaration_accepted: formData.get("declaration_accepted") === "on",
  };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
}
