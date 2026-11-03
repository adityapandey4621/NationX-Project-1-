import type { Locale } from "./config";
import { en, type MessageKey } from "./messages/en";
import { te } from "./messages/te";

const CATALOGUES: Record<Locale, Record<MessageKey, string>> = { en, te };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Pure translator: falls back to English if a string is ever empty, and fills {placeholders}. */
export function createTranslator(locale: Locale): Translate {
  return (key, vars) => {
    const raw = CATALOGUES[locale][key] || en[key];
    return vars ? raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : raw;
  };
}