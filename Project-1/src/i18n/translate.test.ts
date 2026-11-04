import { describe, expect, it } from "vitest";
import { LOCALES, parseLocale } from "./config";
import { en } from "./messages/en";
import { te } from "./messages/te";
import { createTranslator } from "./translate";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("catalogues", () => {
  it("Telugu has exactly the English keys", () => expect(Object.keys(te).sort()).toEqual(Object.keys(en).sort()));
  it("no translation is empty", () => {
    for (const [k, v] of Object.entries(te)) expect(v.trim(), k).not.toBe("");
  });
  it("every translation keeps the same {placeholders} as English", () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(te[k]), k).toEqual(placeholders(en[k]));
  });
  it("Telugu strings actually contain Telugu script (except brand/loanword-only strings)", () => {
    const brandOnly = new Set(["shop.whatsapp"]);
    for (const [k, v] of Object.entries(te)) if (!brandOnly.has(k)) expect(/[\u0C00-\u0C7F]/.test(v), k).toBe(true);
  });
});

describe("createTranslator", () => {
  it("translates and fills placeholders", () => {
    expect(createTranslator("en")("shop.away", { distance: "1.2 km" })).toBe("1.2 km away");
    expect(createTranslator("te")("shop.away", { distance: "1.2 km" })).toBe("1.2 km దూరంలో");
  });
  it("leaves an unknown placeholder visible rather than printing undefined", () => {
    expect(createTranslator("en")("shop.away")).toBe("{distance} away");
    expect(createTranslator("en")("area.all", { nope: "x" })).toBe("All of {city}");
  });
});

describe("parseLocale", () => {
  it.each([undefined, null, "", "fr", "TE", "te;x"])("falls back to English for %s", (v) => expect(parseLocale(v)).toBe("en"));
  it("accepts every supported locale", () => LOCALES.forEach((l) => expect(parseLocale(l)).toBe(l)));
});