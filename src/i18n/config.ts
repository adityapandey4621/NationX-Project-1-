export const LOCALES = ["en", "te"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Non-sensitive preference cookie. */
export const LANG_COOKIE = "nx_lang";

export const LOCALE_LABEL: Record<Locale, string> = { en: "English", te: "తెలుగు" };

export function parseLocale(value: string | undefined | null): Locale {
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : DEFAULT_LOCALE;
}