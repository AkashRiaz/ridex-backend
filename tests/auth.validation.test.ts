import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/app/helper/normalizePhone";
import {
  ChangePasswordZodSchema,
  PasswordZodSchema,
  RegisterZodSchema,
} from "../src/app/module/auth/auth.validation";
import { UpdateUserStatusZodSchema } from "../src/app/module/user/user.validation";

describe("normalizePhone", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["017-1234 5678", "+8801712345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["01212345678", "0171234567", "+15551234567", "abc"])(
    "rejects %s",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe("PasswordZodSchema", () => {
  it("accepts a strong password", () => {
    expect(PasswordZodSchema.safeParse("Ride@2026x").success).toBe(true);
  });

  it.each([
    "short1!",
    "alllowercase1!",
    "ALLUPPER1!",
    "NoNumber!!",
    "NoSpecial12",
  ])("rejects %s", (password) => {
    expect(PasswordZodSchema.safeParse(password).success).toBe(false);
  });
});

describe("RegisterZodSchema", () => {
  const base = { name: "Rider", password: "Ride@2026x", role: "BUYER" };

  it("requires email or phone", () => {
    expect(RegisterZodSchema.safeParse(base).success).toBe(false);
  });

  it("normalizes phone and lowercases email", () => {
    const result = RegisterZodSchema.parse({
      ...base,
      email: "Rider@Example.COM",
      phone: "01712345678",
    });

    expect(result.email).toBe("rider@example.com");
    expect(result.phone).toBe("+8801712345678");
  });

  it("does not allow self-registering staff roles", () => {
    for (const role of [
      "ADMIN",
      "SUPER_ADMIN",
      "MODERATOR",
      "INSPECTOR",
      "DEALER_STAFF",
    ]) {
      expect(
        RegisterZodSchema.safeParse({ ...base, email: "a@b.co", role }).success,
      ).toBe(false);
    }
  });
});

describe("ChangePasswordZodSchema", () => {
  it("rejects reusing the same password", () => {
    expect(
      ChangePasswordZodSchema.safeParse({
        oldPassword: "Ride@2026x",
        newPassword: "Ride@2026x",
      }).success,
    ).toBe(false);
  });
});

describe("UpdateUserStatusZodSchema", () => {
  it("requires a reason when blocking", () => {
    expect(
      UpdateUserStatusZodSchema.safeParse({ status: "BLOCKED" }).success,
    ).toBe(false);
    expect(
      UpdateUserStatusZodSchema.safeParse({ status: "BLOCKED", reason: "Spam" })
        .success,
    ).toBe(true);
    expect(
      UpdateUserStatusZodSchema.safeParse({ status: "ACTIVE" }).success,
    ).toBe(true);
  });
});
