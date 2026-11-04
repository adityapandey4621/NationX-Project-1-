export interface OperatingHoursLike {
  opens: string;
  closes: string;
  closed_days: readonly string[];
}

export type OpenStatus = "open" | "closed";

const IST = "Asia/Kolkata";

/** Weekday name (lower-case English) and minutes since midnight in India Standard Time. */
export function istParts(now: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24; // some engines emit "24" at midnight
  return { weekday: get("weekday").toLowerCase(), minutes: hour * 60 + Number(get("minute")) };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/**
 * Whether the shop is open at `now` (evaluated in IST). Handles weekly closed
 * days and hours that run past midnight (e.g. 18:00–02:00). This reflects the
 * hours the merchant recorded; it is not a live confirmation.
 */
export function getOpenStatus(hours: OperatingHoursLike, now: Date = new Date()): OpenStatus {
  const { weekday, minutes } = istParts(now);
  if (hours.closed_days.map((d) => d.toLowerCase()).includes(weekday)) return "closed";
  const opens = toMinutes(hours.opens);
  const closes = toMinutes(hours.closes);
  if (opens === closes) return "open"; // treated as 24 hours
  return opens < closes ? (minutes >= opens && minutes < closes ? "open" : "closed") : minutes >= opens || minutes < closes ? "open" : "closed";
}

/** Today's date in India as YYYY-MM-DD (the shop's "closed until" is a calendar date, not an instant). */
export function istDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export interface ClosureLike {
  closure_note: string | null;
  closed_until: string | null;
}

/**
 * The shop's own "temporarily closed" notice, if it is still in force. A note with a date lapses on its own the day
 * after that date, so a forgotten notice cannot keep a reopened shop looking closed. A note without a date stays
 * until the shop clears it. This is what the shop says, not a live confirmation.
 */
export function getClosureNotice(sf: ClosureLike, now: Date = new Date()): { note: string; until: string | null } | null {
  const note = sf.closure_note?.trim();
  if (!note) return null;
  if (sf.closed_until && sf.closed_until < istDate(now)) return null;
  return { note, until: sf.closed_until };
}

/** "2030-01-15" → "15 Jan 2030" */
export function formatDateLong(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "08:30" → "8:30 AM" */
export function formatTime12h(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${suffix}`;
}
