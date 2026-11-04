import type { HelpStatus, StockLabel } from "./types";

export const STOCK_LABELS: Record<StockLabel, string> = {
  in_stock: "In stock",
  call_to_confirm: "Call to confirm",
  out_of_stock: "Out of stock",
};

export const HELP_STATUS_LABELS: Record<HelpStatus, string> = {
  pending: "Received",
  under_review: "We are looking",
  matched: "Shop found",
  unresolved: "Could not find it",
  cancelled: "Cancelled",
};

export const MODEL_LABELS: Record<string, string> = {
  visit_only: "Visit the shop",
  pickup: "Pickup",
  delivery: "Delivery",
  appointment: "By appointment",
  quotation: "Quotation",
};

/** Unknown price is never guessed: null reads "Call for price". */
export function formatPrice(value: number | null): string {
  if (value === null) return "Call for price";
  const hasPaise = Math.round(value * 100) % 100 !== 0;
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Accepts 9876543210, 09876543210, 919876543210 or +91 98765 43210 and returns +919876543210 (or null). */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "");
  const m = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

/** Rupees typed by a user ("1,200.50") -> number; blank -> null; anything else -> NaN. */
export function parseMoney(input: string): number | null {
  const v = input.replace(/[,\s₹]/g, "");
  if (v === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : Number.NaN;
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

/** Opening-hours summary like "9:00 AM – 9:00 PM". */
export function formatTime12h(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = Number(h);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m.slice(0, 2)} ${hour < 12 ? "AM" : "PM"}`;
}

/** The public storefront link used for sharing and deep links. */
export function shopWebUrl(webUrl: string, slug: string): string {
  return `${webUrl.replace(/\/+$/, "")}/shop/${encodeURIComponent(slug)}`;
}

/** Digits for wa.me; null when the number is unusable. */
export function whatsappDigits(raw: string | null): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d : null;
}