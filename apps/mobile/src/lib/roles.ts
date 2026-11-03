import type { Me, MyBusiness, UserRole } from "./types";

/**
 * UI-only role helpers. They decide what to SHOW; the server and database decide what is ALLOWED, so a
 * tampered app still cannot do anything its account may not (roles come from the user_roles table).
 */
export const hasRole = (me: Me | null | undefined, role: UserRole): boolean => !!me?.roles.includes(role);

/** Admin/operator tools are web-only; the app never links to them. */
export const isMerchant = (me: Me | null | undefined): boolean => hasRole(me, "merchant");

export const canManage = (role: MyBusiness["role"]): boolean => role === "owner" || role === "manager";

export const roleLabel = (role: MyBusiness["role"]): string => (role === "employee" ? "Staff (view only)" : role === "manager" ? "Manager" : "Owner");