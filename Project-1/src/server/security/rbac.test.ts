import { describe, expect, it } from "vitest";
import { hasAnyRole, hasRole, navItemsForRoles, safeRedirectPath } from "./rbac";

describe("role checks", () => {
  it("hasRole / hasAnyRole reflect membership", () => {
    expect(hasRole(["customer"], "admin")).toBe(false);
    expect(hasRole(["customer", "admin"], "admin")).toBe(true);
    expect(hasAnyRole(["customer"], ["admin", "merchant"])).toBe(false);
    expect(hasAnyRole(["merchant"], ["admin", "merchant"])).toBe(true);
    expect(hasAnyRole([], ["admin"])).toBe(false);
  });
});

describe("navItemsForRoles", () => {
  it("offers plain customers the way to become a merchant, and no privileged links", () => {
    expect(navItemsForRoles(["customer"])).toEqual([{ label: "Add your shop", href: "/merchant" }]);
  });
  it("labels the workspace for merchants and adds Admin only for admins", () => {
    expect(navItemsForRoles(["customer", "merchant"])).toEqual([{ label: "My shop", href: "/merchant" }]);
    expect(navItemsForRoles(["customer", "admin"]).map((i) => i.href)).toEqual(["/merchant", "/admin", "/admin/help-requests", "/admin/waitlist"]);
    expect(navItemsForRoles(["merchant", "admin"]).map((i) => i.label)).toEqual(["My shop", "Admin", "Help requests", "Waitlist"]);
  });
  it("gives operators the help-request queue but not the admin area", () => {
    const hrefs = navItemsForRoles(["customer", "operator"]).map((i) => i.href);
    expect(hrefs).toContain("/admin/help-requests");
    expect(hrefs).not.toContain("/admin");
  });
});

describe("safeRedirectPath (open-redirect protection)", () => {
  it("allows same-origin relative paths", () => {
    expect(safeRedirectPath("/account")).toBe("/account");
    expect(safeRedirectPath("/admin?tab=1")).toBe("/admin?tab=1");
  });
  it("falls back for missing or external destinations", () => {
    expect(safeRedirectPath(undefined)).toBe("/account");
    expect(safeRedirectPath(null)).toBe("/account");
    expect(safeRedirectPath("")).toBe("/account");
    expect(safeRedirectPath("https://evil.example")).toBe("/account");
    expect(safeRedirectPath("//evil.example")).toBe("/account");
    expect(safeRedirectPath("/\\evil.example")).toBe("/account");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/account");
    expect(safeRedirectPath("evil", "/home")).toBe("/home");
  });
});
