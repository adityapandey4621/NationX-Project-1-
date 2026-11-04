/** Default number of days integration events are kept (the database enforces a floor of 7 whatever is passed). */
export const DEFAULT_EVENT_RETENTION_DAYS = 30;

/**
 * Reads EVENT_RETENTION_DAYS. Anything that is not a whole number of at least 7 falls back to the default, so a
 * typo can neither delete events too early nor stop retention from ever running.
 */
export function eventRetentionDays(raw: string | undefined): number {
  if (!raw || !/^\d{1,4}$/.test(raw.trim())) return DEFAULT_EVENT_RETENTION_DAYS;
  const days = Number(raw.trim());
  return days >= 7 ? days : DEFAULT_EVENT_RETENTION_DAYS;
}
