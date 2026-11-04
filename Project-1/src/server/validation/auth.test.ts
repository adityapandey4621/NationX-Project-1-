import { describe, expect, it } from "vitest";
import { signInInput, signUpInput, updateProfileInput } from "./auth";

const validSignUp = {
  full_name: "  Asha Rao ",
  email: "  Asha@Example.COM ",
  phone: "+919876543210",
  password: "correct horse",
};

describe("signUpInput", () => {
  it("normalises name and email and defaults language", () => {
    const parsed = signUpInput.parse(validSignUp);
    expect(parsed.email).toBe("asha@example.com");
    expect(parsed.full_name).toBe("Asha Rao");
    expect(parsed.preferred_language).toBe("en");
  });
  it("rejects weak, oversized or malformed input", () => {
    expect(signUpInput.safeParse({ ...validSignUp, password: "short" }).success).toBe(false);
    expect(signUpInput.safeParse({ ...validSignUp, password: "x".repeat(73) }).success).toBe(false);
    expect(signUpInput.safeParse({ ...validSignUp, email: "not-an-email" }).success).toBe(false);
    expect(signUpInput.safeParse({ ...validSignUp, phone: "12345" }).success).toBe(false);
    expect(signUpInput.safeParse({ ...validSignUp, full_name: "   " }).success).toBe(false);
  });
  it("does not carry a role through", () => {
    const parsed = signUpInput.parse({ ...validSignUp, role: "admin", roles: ["admin"] });
    expect(parsed).not.toHaveProperty("role");
    expect(parsed).not.toHaveProperty("roles");
  });
});

describe("signInInput", () => {
  it("requires email and password", () => {
    expect(signInInput.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(signInInput.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
});

describe("updateProfileInput", () => {
  it("accepts partial updates of permitted fields", () => {
    expect(updateProfileInput.parse({ full_name: "New Name" })).toEqual({ full_name: "New Name" });
  });
  it("rejects empty updates", () => {
    expect(updateProfileInput.safeParse({}).success).toBe(false);
  });
  it("strips privileged fields so they cannot be self-assigned", () => {
    const parsed = updateProfileInput.parse({
      full_name: "X Y",
      is_active: true,
      role: "admin",
      id: "00000000-0000-0000-0000-000000000000",
      email: "evil@example.com",
    });
    expect(parsed).toEqual({ full_name: "X Y" });
  });
});
