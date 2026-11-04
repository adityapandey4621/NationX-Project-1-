/**
 * Before/after comparison for a resubmitted application (REQ-ADM-01). "Before" is the content the administrator saw
 * when corrections were requested (kept by the database, migration 021); "after" is the application now. Only fields
 * that really changed are returned, in a fixed, readable order.
 */
export interface DiffRow {
  field: string;
  label: string;
  before: string;
  after: string;
}

type Kind = "text" | "time" | "number" | "set" | "bool" | "id" | "details";
const FIELDS: { key: string; label: string; kind: Kind }[] = [
  { key: "business_name", label: "Shop name", kind: "text" },
  { key: "category_id", label: "Category", kind: "id" },
  { key: "subcategory_id", label: "Subcategory", kind: "id" },
  { key: "business_description", label: "Description", kind: "text" },
  { key: "contact_phone", label: "Shop phone", kind: "text" },
  { key: "whatsapp_number", label: "WhatsApp", kind: "text" },
  { key: "contact_email", label: "Email", kind: "text" },
  { key: "address_line1", label: "Address", kind: "text" },
  { key: "address_line2", label: "Address line 2", kind: "text" },
  { key: "landmark", label: "Landmark", kind: "text" },
  { key: "locality_id", label: "Area", kind: "id" },
  { key: "pincode", label: "PIN code", kind: "text" },
  { key: "latitude", label: "Latitude", kind: "number" },
  { key: "longitude", label: "Longitude", kind: "number" },
  { key: "opening_time", label: "Opens", kind: "time" },
  { key: "closing_time", label: "Closes", kind: "time" },
  { key: "weekly_off_days", label: "Weekly off days", kind: "set" },
  { key: "operating_models", label: "How customers shop", kind: "set" },
  { key: "category_specific_data", label: "Category questions", kind: "details" },
  { key: "declaration_accepted", label: "Declaration accepted", kind: "bool" },
];

const NONE = "—";
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

function normalise(kind: Kind, v: unknown): string {
  if (blank(v)) return "";
  switch (kind) {
    case "time":
      return String(v).slice(0, 5);
    case "number":
      return String(Number(v));
    case "set":
      return (Array.isArray(v) ? v.map(String) : [String(v)]).sort().join(",");
    case "bool":
      return v === true ? "true" : "false";
    case "details": {
      if (typeof v !== "object" || v === null) return "";
      const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => !blank(x)).sort(([a], [b]) => a.localeCompare(b));
      return entries.length ? JSON.stringify(entries) : "";
    }
    default:
      return String(v).trim();
  }
}

function show(kind: Kind, v: unknown, resolve?: (field: string, id: string) => string | undefined, field = ""): string {
  const n = normalise(kind, v);
  if (n === "") return NONE;
  switch (kind) {
    case "set":
      return n.split(",").join(", ");
    case "bool":
      return n === "true" ? "Yes" : "No";
    case "id":
      return resolve?.(field, n) ?? n;
    case "details":
      return (JSON.parse(n) as [string, unknown][]).map(([k, x]) => `${k.replace(/_/g, " ")}: ${typeof x === "boolean" ? (x ? "Yes" : "No") : String(x)}`).join("; ");
    default:
      return n;
  }
}

/** Changed fields only. `resolve` turns an id (category, subcategory, area) into a name for display. */
export function diffApplication(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  resolve?: (field: string, id: string) => string | undefined,
): DiffRow[] {
  if (!before) return [];
  const rows: DiffRow[] = [];
  for (const f of FIELDS) {
    if (normalise(f.kind, before[f.key]) === normalise(f.kind, after[f.key])) continue;
    rows.push({ field: f.key, label: f.label, before: show(f.kind, before[f.key], resolve, f.key), after: show(f.kind, after[f.key], resolve, f.key) });
  }
  return rows;
}
