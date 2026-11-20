import httpStatus from "http-status";
import { Role } from "../../../generated/prisma/enums";
import { AppError } from "../../utils/AppError";

type TActor = { userId: string; role: Role };
type TTarget = { id: string; role: Role };

/*
 * Roles each manager may create through POST /users.
 * DEALER_STAFF is created by dealers (Phase 2), SUPER_ADMIN only by seed.
 */
export const CREATABLE_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: [
    Role.ADMIN,
    Role.MODERATOR,
    Role.INSPECTOR,
    Role.DEALER,
    Role.SELLER,
    Role.BUYER,
  ],
  ADMIN: [Role.MODERATOR, Role.INSPECTOR, Role.DEALER, Role.SELLER, Role.BUYER],
};

export const canCreateRole = (actorRole: Role, targetRole: Role) =>
  CREATABLE_ROLES[actorRole]?.includes(targetRole) ?? false;

/*
 * Guards every admin action on another account:
 * - nobody manages themselves through admin endpoints
 * - SUPER_ADMIN accounts are untouchable
 * - only SUPER_ADMIN may manage ADMIN accounts
 */
export const assertCanManageUser = (actor: TActor, target: TTarget) => {
  if (actor.userId === target.id) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You cannot perform this action on your own account",
    );
  }

  if (target.role === Role.SUPER_ADMIN) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Super admin accounts cannot be modified",
    );
  }

  if (target.role === Role.ADMIN && actor.role !== Role.SUPER_ADMIN) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only a super admin can manage admin accounts",
    );
  }
};

export const userSearchableFields = ["name", "email", "phone"];

export const userSortableFields = [
  "name",
  "email",
  "role",
  "status",
  "lastLoginAt",
  "createdAt",
  "updatedAt",
];
