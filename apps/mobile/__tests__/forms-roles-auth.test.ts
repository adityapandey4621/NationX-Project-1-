import { describeAuthError } from "../src/lib/auth";
import { checkHelpRequest, checkSignIn, checkSignUp, hasErrors } from "../src/lib/forms";
import { canManage, hasRole, isMerchant } from "../src/lib/roles";
import type { Me } from "../src/lib/types";
import { shouldRetry, shouldPersist } from "../src/state/query-client";
import { ApiError } from "../src/lib/api";

const me = (roles: Me["roles"]): Me => ({ roles, profile: { id: "u", full_name: "A", phone: "+919876543210", email: "a@b.in", preferred_language: "en", is_active: true } });

describe("form checks (immediate feedback only)", () => {
  it("flags every bad sign-up field", () => {
    const e = checkSignUp({ full_name: " ", email: "nope", phone: "123", password: "short" });
    expect(Object.keys(e).sort()).toEqual(["email", "full_name", "password", "phone"]);
    expect(hasErrors(checkSignUp({ full_name: "Ravi", email: "r@x.in", phone: "9876543210", password: "longenough" }))).toBe(false);
  });
  it("sign-in only needs an email and a password", () => {
    expect(hasErrors(checkSignIn({ email: "r@x.in", password: "x" }))).toBe(false);
    expect(checkSignIn({ email: "", password: "" })).toHaveProperty("password");
  });
  it("help request needs item, name, phone, area and consent", () => {
    const e = checkHelpRequest({ item_name: "a", contact_name: "", contact_phone: "1", locality_id: "", consent: false });
    expect(Object.keys(e)).toHaveLength(5);
    expect(hasErrors(checkHelpRequest({ item_name: "Sesame oil", contact_name: "Ravi", contact_phone: "9876543210", locality_id: "x", consent: true }))).toBe(false);
  });
});

describe("roles are display hints only", () => {
  it("derives merchant UI from server-provided roles", () => {
    expect(isMerchant(me(["customer", "merchant"]))).toBe(true);
    expect(isMerchant(me(["customer"]))).toBe(false);
    expect(isMerchant(null)).toBe(false);
    expect(hasRole(me(["admin"]), "admin")).toBe(true);
  });
  it("only owners and managers see edit controls", () => {
    expect(canManage("owner")).toBe(true);
    expect(canManage("manager")).toBe(true);
    expect(canManage("employee")).toBe(false);
  });
});

describe("auth error wording", () => {
  it("never reveals whether an email exists when signing in", () => {
    expect(describeAuthError({ message: "Invalid login credentials", status: 400 }, "sign-in").message).toBe("Incorrect email or password.");
    expect(describeAuthError({ message: "User not found", status: 400 }, "sign-in").message).toBe("Incorrect email or password.");
  });
  it("explains unconfirmed email, throttling and offline", () => {
    expect(describeAuthError({ message: "Email not confirmed" }, "sign-in").message).toMatch(/confirm your email/);
    expect(describeAuthError({ message: "x", status: 429 }, "sign-in").message).toMatch(/Too many/);
    expect(describeAuthError({ message: "Network request failed", status: 0 }, "sign-in").message).toMatch(/connection/);
  });
  it("points a duplicate phone at the phone field", () => {
    expect(describeAuthError({ message: "duplicate phone" }, "sign-up").field).toBe("phone");
  });
});

describe("cache policy", () => {
  it("does not retry requests the server refused, but retries connectivity trouble twice", () => {
    expect(shouldRetry(0, new ApiError("FORBIDDEN", "no", 403))).toBe(false);
    expect(shouldRetry(0, new ApiError("VALIDATION_FAILED", "bad", 400))).toBe(false);
    expect(shouldRetry(0, new ApiError("NETWORK", "offline"))).toBe(true);
    expect(shouldRetry(2, new ApiError("NETWORK", "offline"))).toBe(false);
  });
  it("persists only anonymous discovery data to disk", () => {
    expect(shouldPersist(["public", "home", "all"], "success")).toBe(true);
    expect(shouldPersist(["me"], "success")).toBe(false);
    expect(shouldPersist(["requests"], "success")).toBe(false);
    expect(shouldPersist(["merchant", "products", "x"], "success")).toBe(false);
    expect(shouldPersist(["public", "shop", "x"], "error")).toBe(false);
  });
});