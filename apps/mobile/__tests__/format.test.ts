import { formatPrice, formatTime12h, normalizeIndianPhone, parseMoney, shopWebUrl, whatsappDigits } from "../src/lib/format";

describe("normalizeIndianPhone", () => {
  it.each([["9876543210"], ["09876543210"], ["919876543210"], ["+91 98765 43210"], ["+91-98765-43210"]])("accepts %s", (input) => {
    expect(normalizeIndianPhone(input)).toBe("+919876543210");
  });
  it.each([["12345"], ["5876543210"], ["98765432101"], [""], ["abcdefghij"]])("rejects %s", (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });
});

describe("money", () => {
  it("never invents a price", () => {
    expect(formatPrice(null)).toBe("Call for price");
    expect(formatPrice(0)).toBe("₹0");
  });
  it("formats rupees with Indian grouping", () => {
    expect(formatPrice(45)).toBe("₹45");
    expect(formatPrice(45.5)).toBe("₹45.50");
    expect(formatPrice(125000)).toBe("₹1,25,000");
  });
  it("parses what people type", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("1,200.50")).toBe(1200.5);
    expect(parseMoney("₹ 45")).toBe(45);
    expect(parseMoney("12.345")).toBeNaN();
    expect(parseMoney("-5")).toBeNaN();
    expect(parseMoney("abc")).toBeNaN();
  });
});

describe("misc formatting", () => {
  it("formats 12-hour times", () => {
    expect(formatTime12h("00:00")).toBe("12:00 AM");
    expect(formatTime12h("09:30")).toBe("9:30 AM");
    expect(formatTime12h("12:05")).toBe("12:05 PM");
    expect(formatTime12h("21:00")).toBe("9:00 PM");
  });
  it("builds a shareable storefront link", () => {
    expect(shopWebUrl("https://nationx.in/", "sri-ram-kirana")).toBe("https://nationx.in/shop/sri-ram-kirana");
  });
  it("extracts WhatsApp digits or nothing", () => {
    expect(whatsappDigits("+91 98765 43210")).toBe("919876543210");
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappDigits("123")).toBeNull();
  });
});