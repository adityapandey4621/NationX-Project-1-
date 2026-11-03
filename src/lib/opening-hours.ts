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

/** "08:30" → "8:30 AM" */
export function formatTime12h(hhmm: string): string {
  const [h = "0", m = "00"] = hhmm.split(":");
  const hour = Number(h);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${suffix}`;
}
