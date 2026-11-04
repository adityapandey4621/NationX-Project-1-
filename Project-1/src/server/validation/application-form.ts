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

/**
 * For an optional field that IS on the form: blank means "clear it" (null), so emptying a field and saving really
 * removes the old value. A field that is not on the form at all stays untouched (undefined).
 */
function clearableText(formData: FormData, key: string): string | null | undefined {
  return formData.has(key) ? (text(formData, key) ?? null) : undefined;
}
function clearableNumber(formData: FormData, key: string): number | null | undefined {
  return formData.has(key) ? (number(formData, key) ?? null) : undefined;
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
    subcategory_id: clearableText(formData, "subcategory_id"),
    contact_phone: text(formData, "contact_phone"),
    contact_email: clearableText(formData, "contact_email"),
    whatsapp_number: clearableText(formData, "whatsapp_number"),
    address_line1: text(formData, "address_line1"),
    address_line2: clearableText(formData, "address_line2"),
    locality_id: text(formData, "locality_id"),
    pincode: clearableText(formData, "pincode"),
    landmark: clearableText(formData, "landmark"),
    latitude: clearableNumber(formData, "latitude"),
    longitude: clearableNumber(formData, "longitude"),
    opening_time: clearableText(formData, "opening_time"),
    closing_time: clearableText(formData, "closing_time"),
    weekly_off_days: many(formData, "weekly_off_days", WEEKDAYS),
    business_description: clearableText(formData, "business_description"),
    operating_models: many(formData, "operating_models", OPERATING_MODELS),
    declaration_accepted: formData.get("declaration_accepted") === "on",
  };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
}
