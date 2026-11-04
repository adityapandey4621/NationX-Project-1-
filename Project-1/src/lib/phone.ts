/**
 * Accepts how people actually type Indian mobile numbers ("98480 12345",
 * "09848012345", "+91 98480-12345", "919848012345") and returns E.164
 * (+919848012345), or the trimmed input unchanged if it can't be interpreted,
 * so schema validation still reports a clear error.
 */
export function normalizeIndianPhone(input: string): string {
  const raw = input.trim();
  const digits = raw.replace(/[\s\-().]/g, "");
  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0?[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(-10)}`;
  return raw;
}
