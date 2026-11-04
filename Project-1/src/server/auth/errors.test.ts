import { describe, expect, it } from "vitest";
import { describeSignInError, describeSignUpError } from "./errors";

describe("describeSignInError", () => {
  it("uses one message for bad credentials", () => {
    expect(describeSignInError({ code: "invalid_credentials", status: 400 })).toBe("Invalid email or password.");
  });
  it("explains unconfirmed email and rate limits", () => {
    expect(describeSignInError({ code: "email_not_confirmed" })).toMatch(/confirm your email/i);
    expect(describeSignInError({ status: 429 })).toMatch(/too many attempts/i);
  });
  it("does not leak raw provider messages", () => {
    expect(describeSignInError({ message: "internal stack trace xyz", status: 500 })).not.toMatch(/xyz/);
  });
});

describe("describeSignUpError", () => {
  it("maps existing accounts and trigger failures", () => {
    expect(describeSignUpError({ code: "user_already_exists" })).toMatch(/already exists/i);
    expect(describeSignUpError({ message: "Database error saving new user" })).toMatch(/already be registered/i);
    expect(describeSignUpError({ code: "weak_password" })).toMatch(/too weak/i);
  });
  it("falls back to a generic message", () => {
    expect(describeSignUpError({ message: "boom" })).toMatch(/couldn't create your account/i);
  });
});
