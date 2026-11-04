import { describe, expect, it } from "vitest";
import { presentCategory, presentTemplate, TEMPLATE_KEYS, TEMPLATES } from "./presentation";

describe("category presentation", () => {
  it("picks an icon by slug keyword", () => {
    expect(presentCategory("fruits-vegetables").icon).toBe(presentCategory("fruit-shop").icon);
    expect(presentCategory("pharmacy").toneKey).toBe("teal");
    expect(presentCategory("salons").toneKey).toBe("rose");
  });

  it("falls back to the template for a category it has never seen (no code change needed)", () => {
    const unknown = presentCategory("quantum-widgets", "service_provider");
    expect(unknown.icon).toBe(TEMPLATES.service_provider.icon);
    expect(unknown.toneKey).toBe(TEMPLATES.service_provider.tone);
  });

  it("is case-insensitive and never throws on odd input", () => {
    expect(presentCategory("KIRANA").toneKey).toBe("green");
    expect(() => presentCategory("")).not.toThrow();
  });
});

describe("template presentation", () => {
  it("covers every template the database allows", () => {
    for (const key of TEMPLATE_KEYS) expect(TEMPLATES[key]).toBeDefined();
  });

  it("does not show stock for service providers", () => {
    expect(presentTemplate("service_provider").showStock).toBe(false);
    expect(presentTemplate("grocery").showStock).toBe(true);
  });

  it("treats unknown or missing templates as standard retail", () => {
    expect(presentTemplate("future_template")).toBe(TEMPLATES.standard_retail);
    expect(presentTemplate(null)).toBe(TEMPLATES.standard_retail);
  });
});
