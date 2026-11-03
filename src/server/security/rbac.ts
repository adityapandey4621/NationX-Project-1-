import type { UserRole } from "../validation";

/**
 * Pure role helpers. The source of truth for roles is the `user_roles` table
 * (never JWT/user metadata, which the user can edit). Database RLS is the
 * enforcement layer; these helpers drive server-side route guards and UI.
 */

export function hasRole(roles: readonly UserRole[], role: UserRole): boolean {
  return roles.includes(role);
}

export function hasAnyRole(roles: readonly UserRole[], allowed: readonly UserRole[]): boolean {
  return allowed.some((r) => roles.includes(r));
}

export interface NavItem {
  label: string;
  href: string;
}

/**
 * Role-aware navigation for signed-in users. Everyone can apply to list a
 * shop (it is how one becomes a merchant); merchants see their workspace.
 * Hiding a link is a convenience, not security.
 */
export function navItemsForRoles(roles: readonly UserRole[]): NavItem[] {
  const items: NavItem[] = [
    hasRole(roles, "merchant")
      ? { label: "My shop", href: "/merchant" }
      : { label: "Add your shop", href: "/merchant" },
  ];
  if (hasRole(roles, "admin")) items.push({ label: "Admin", href: "/admin" });
  if (hasAnyRole(roles, ["admin", "operator"])) {
    items.push({ label: "Help requests", href: "/admin/help-requests" });
    items.push({ label: "Waitlist", href: "/admin/waitlist" });
  }
  return items;
}

/**
 * Only same-origin relative paths are accepted as post-login destinations,
 * preventing open redirects (e.g. `//evil.com`, `https://evil.com`, `/\evil.com`).
 */
export function safeRedirectPath(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  return next;
}
