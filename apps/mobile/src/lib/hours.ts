import type { OperatingHours } from "./types";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const IST_OFFSET_MIN = 330; // India has no daylight saving; avoids relying on Intl time-zone support on-device

/** Weekday name and minutes since midnight in India Standard Time. */
export function istParts(now: Date): { weekday: string; minutes: number } {
  const shifted = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return { weekday: DAYS[shifted.getUTCDay()] ?? "sunday", minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * Display-only: whether the hours the merchant recorded say "open" right now (IST). Handles weekly closed days
 * and overnight hours. Same rule as the website; it is not a live confirmation that the shop is open.
 */
export function isOpenNow(hours: OperatingHours, now: Date = new Date()): boolean {
  const { weekday, minutes } = istParts(now);
  if (hours.closed_days.map((d) => d.toLowerCase()).includes(weekday)) return false;
  const opens = toMinutes(hours.opens);
  const closes = toMinutes(hours.closes);
  if (opens === closes) return true;
  return opens < closes ? minutes >= opens && minutes < closes : minutes >= opens || minutes < closes;
}