import { describe, expect, it } from "vitest";
import { normalizeIndianPhone } from "./phone";
import { buildListingHref, firstParam, pageToOffset, parsePage, safeBackHref, totalPages } from "./search-url";

describe("buildListingHref", () => {
  it("omits empty values and defaults", () => {
    expect(buildListingHref("/search", {})).toBe("/search");
    expect(buildListingHref("/search", { q: "", sort: "relevance", page: 1 })).toBe("/search");
  });
  it("encodes values and keeps filters", () => {
    expect(buildListingHref("/search", { q: "pooja lamp & oil", category: "kirana", locality: "wyra-road", model: "pickup", sort: "name", page: 3 })).toBe(
      "/search?q=pooja+lamp+%26+oil&category=kirana&locality=wyra-road&model=pickup&sort=name&page=3",
    );
  });
});

describe("paging helpers", () => {
  it("parses pages defensively", () => {
    expect(parsePage("2")).toBe(2);
    for (const bad of [undefined, "", "0", "-1", "abc", "1.5", "501", ["x"]]) expect(parsePage(bad as never)).toBe(1);
    expect(parsePage(["4", "9"])).toBe(4);
  });
  it("converts to offsets and counts pages", () => {
    expect(pageToOffset(1)).toBe(0);
    expect(pageToOffset(3, 12)).toBe(24);
    expect(totalPages(0)).toBe(1);
    expect(totalPages(25, 12)).toBe(3);
    expect(totalPages(24, 12)).toBe(2);
  });
  it("firstParam ignores blanks", () => {
    expect(firstParam("  ")).toBeUndefined();
    expect(firstParam(["a", "b"])).toBe("a");
  });
});

describe("safeBackHref (no open redirects)", () => {
  it("allows listing pages on this site", () => {
    expect(safeBackHref("/search?q=oil&page=2")).toBe("/search?q=oil&page=2");
    expect(safeBackHref("/category/kirana")).toBe("/category/kirana");
    expect(safeBackHref("/locality/wyra-road?category=kirana")).toBe("/locality/wyra-road?category=kirana");
    expect(safeBackHref("/")).toBe("/");
  });
  it("rejects everything else", () => {
    for (const bad of [
      "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/admin", "/merchant/apply",
      "/account", "/search/../admin", "/category/", "/category/a/b", "/api/v1/me", "x".repeat(400), "", undefined,
    ]) expect(safeBackHref(bad as never)).toBeNull();
  });
});

describe("normalizeIndianPhone", () => {
  it("normalises common ways of typing a mobile number", () => {
    for (const ok of ["9848012345", "98480 12345", "098480 12345", "+91 98480-12345", "919848012345", "+919848012345", "(+91) 98480 12345"]) {
      expect(normalizeIndianPhone(ok)).toBe("+919848012345");
    }
  });
  it("leaves invalid input untouched so validation can reject it", () => {
    expect(normalizeIndianPhone("12345")).toBe("12345");
    expect(normalizeIndianPhone("5848012345")).toBe("5848012345"); // must start 6-9
    expect(normalizeIndianPhone("hello")).toBe("hello");
  });
});
