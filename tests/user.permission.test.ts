import { describe, expect, it } from "vitest";
import { Role } from "../src/generated/prisma/enums";
import {
  assertCanManageUser,
  canCreateRole,
} from "../src/app/module/user/user.utils";

const superAdmin = { userId: "sa", role: Role.SUPER_ADMIN };
const admin = { userId: "a1", role: Role.ADMIN };

describe("assertCanManageUser", () => {
  it("blocks acting on your own account", () => {
    expect(() =>
      assertCanManageUser(admin, { id: "a1", role: Role.ADMIN }),
    ).toThrow(/own account/);
  });

  it("protects super admin accounts from everyone", () => {
    expect(() =>
      assertCanManageUser(superAdmin, { id: "sa2", role: Role.SUPER_ADMIN }),
    ).toThrow(/Super admin/);
    expect(() =>
      assertCanManageUser(admin, { id: "sa", role: Role.SUPER_ADMIN }),
    ).toThrow(/Super admin/);
  });

  it("only super admin can manage admins", () => {
    expect(() =>
      assertCanManageUser(admin, { id: "a2", role: Role.ADMIN }),
    ).toThrow(/Only a super admin/);
    expect(() =>
      assertCanManageUser(superAdmin, { id: "a2", role: Role.ADMIN }),
    ).not.toThrow();
  });

  it("admins can manage marketplace users", () => {
    for (const role of [Role.SELLER, Role.BUYER, Role.DEALER, Role.MODERATOR]) {
      expect(() => assertCanManageUser(admin, { id: "u1", role })).not.toThrow();
    }
  });

  it("returns 403 errors", () => {
    try {
      assertCanManageUser(admin, { id: "a1", role: Role.ADMIN });
    } catch (error) {
      expect((error as { statusCode: number }).statusCode).toBe(403);
    }
  });
});

describe("canCreateRole", () => {
  it("nobody can create SUPER_ADMIN or DEALER_STAFF", () => {
    for (const actor of [Role.SUPER_ADMIN, Role.ADMIN]) {
      expect(canCreateRole(actor, Role.SUPER_ADMIN)).toBe(false);
      expect(canCreateRole(actor, Role.DEALER_STAFF)).toBe(false);
    }
  });

  it("only super admin can create admins", () => {
    expect(canCreateRole(Role.SUPER_ADMIN, Role.ADMIN)).toBe(true);
    expect(canCreateRole(Role.ADMIN, Role.ADMIN)).toBe(false);
  });

  it("non-manager roles cannot create anyone", () => {
    for (const actor of [Role.MODERATOR, Role.SELLER, Role.BUYER, Role.DEALER]) {
      expect(canCreateRole(actor, Role.BUYER)).toBe(false);
    }
  });
});
