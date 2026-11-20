import bcrypt from "bcrypt";
import httpStatus from "http-status";
import {
  AuditAction,
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import { UserWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { generateRandomPassword } from "../../helper/generateRandomPassword";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog } from "../../utils/auditLogger";
import { sendEmail } from "../../utils/sendEmail";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import { IRequestMeta } from "../auth/auth.interface";
import { revokeAllUserRefreshTokens } from "../auth/auth.utils";
import {
  ICreateUserPayload,
  IDeleteMyAccountPayload,
  IUpdateMyProfilePayload,
  IUpdateUserRolePayload,
  IUpdateUserStatusPayload,
} from "./user.interface";
import {
  assertCanManageUser,
  canCreateRole,
  userSearchableFields,
  userSortableFields,
} from "./user.utils";

const findUserOrThrow = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: { id },
    omit: { password: true },
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return user;
};

// ============================================
// Self-service (/users/me)
// ============================================

const getMyProfile = async (userId: string) => {
  const user = await findUserOrThrow(userId);

  if (user.isDeleted) {
    throw new AppError(httpStatus.FORBIDDEN, "Account has been deleted");
  }

  return user;
};

const updateMyProfile = async (
  userId: string,
  payload: IUpdateMyProfilePayload,
  avatar: Express.Multer.File | null,
) => {
  const user = await getMyProfile(userId);

  if (avatar && !avatar.mimetype.startsWith("image/")) {
    throw new AppError(
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
      "Avatar must be an image",
    );
  }

  let avatarResult: { secure_url: string; public_id: string } | null = null;

  if (avatar) {
    avatarResult = await uploadToCloudinary(avatar, {
      folder: `${config.app_name.toLowerCase()}/avatars`,
    });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...payload,
      ...(avatarResult && {
        imageUrl: avatarResult.secure_url,
        imagePublicId: avatarResult.public_id,
      }),
    },
    omit: { password: true },
  });

  // Side effects AFTER commit — remove the replaced avatar
  if (avatarResult && user.imagePublicId) {
    await deleteFromCloudinary(user.imagePublicId);
  }

  return updatedUser;
};

const deleteMyAccount = async (
  userId: string,
  payload: IDeleteMyAccountPayload,
  meta: IRequestMeta,
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.role === Role.SUPER_ADMIN) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "The super admin account cannot be deleted",
    );
  }

  if (user.password) {
    const isPasswordMatched = await bcrypt.compare(
      payload.password ?? "",
      user.password,
    );

    if (!isPasswordMatched) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Password is incorrect");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        isDeleted: true,
        status: UserStatus.INACTIVE,
        deletedAt: new Date(),
      },
    });

    await revokeAllUserRefreshTokens(userId, tx);

    await createAuditLog(
      {
        userId,
        action: AuditAction.DELETE,
        entity: "User",
        entityId: userId,
        newData: { by: "SELF" },
        ...meta,
      },
      tx,
    );
  });
};

// ============================================
// Admin management
// ============================================

const createUser = async (
  actor: RequestUser,
  payload: ICreateUserPayload,
  meta: IRequestMeta,
) => {
  if (!canCreateRole(actor.role, payload.role)) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      `You are not allowed to create ${payload.role} accounts`,
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: payload.email },
        ...(payload.phone ? [{ phone: payload.phone }] : []),
      ],
    },
  });

  if (existingUser) {
    throw new AppError(
      httpStatus.CONFLICT,
      "User with this email or phone already exists",
    );
  }

  // Generate temp password and hash it
  const tempPassword = generateRandomPassword();
  const hashedPassword = await bcrypt.hash(
    tempPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: payload.name,
        email: payload.email,
        phone: payload.phone ?? null,
        password: hashedPassword,
        role: payload.role,
        authProvider: AuthProvider.CREDENTIALS,
        status: UserStatus.ACTIVE,
        needPasswordChange: true,
        // the admin provided the address and the temp password is sent there
        emailVerified: true,
        createdById: actor.userId,
      },
      omit: { password: true },
    });

    await createAuditLog(
      {
        userId: actor.userId,
        action: AuditAction.CREATE,
        entity: "User",
        entityId: createdUser.id,
        newData: { role: createdUser.role, email: createdUser.email },
        ...meta,
      },
      tx,
    );

    return createdUser;
  });

  // Side effects AFTER commit — send credentials
  await sendEmail({
    to: payload.email,
    subject: `Your ${config.app_name} account has been created`,
    template: "staff-welcome",
    data: {
      name: user.name,
      email: payload.email,
      role: user.role.replaceAll("_", " ").toLowerCase(),
      tempPassword,
    },
  });

  return user;
};

const getAllUsers = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query);

  const orderBy = queryBuilder.buildSort(query, userSortableFields);

  const andConditions: UserWhereInput[] = [];

  /*
   * Search
   */
  const searchCondition = queryBuilder.buildSearch(
    query.searchTerm,
    userSearchableFields,
  );

  if (searchCondition) {
    andConditions.push(searchCondition as UserWhereInput);
  }

  /*
   * Filters
   */
  if (query.role && Object.values(Role).includes(query.role)) {
    andConditions.push({ role: query.role });
  }

  if (query.status && Object.values(UserStatus).includes(query.status)) {
    andConditions.push({ status: query.status });
  }

  // deleted users are hidden unless explicitly requested
  andConditions.push({ isDeleted: query.isDeleted === "true" });

  if (query.emailVerified) {
    andConditions.push({ emailVerified: query.emailVerified === "true" });
  }

  if (query.phoneVerified) {
    andConditions.push({ phoneVerified: query.phoneVerified === "true" });
  }

  const users = await prisma.user.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy,
    omit: { password: true },
  });

  const total = await prisma.user.count({
    where: { AND: andConditions },
  });

  return {
    data: users,
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getUserById = async (id: string) => findUserOrThrow(id);

const updateUserStatus = async (
  actor: RequestUser,
  id: string,
  payload: IUpdateUserStatusPayload,
  meta: IRequestMeta,
) => {
  const target = await findUserOrThrow(id);

  assertCanManageUser(actor, target);

  if (target.isDeleted) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Restore the account before changing its status",
    );
  }

  if (target.status === payload.status) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `User is already ${payload.status.toLowerCase()}`,
    );
  }

  const isBlocking = payload.status === UserStatus.BLOCKED;

  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id },
      data: {
        status: payload.status,
        blockedReason: isBlocking ? (payload.reason ?? null) : null,
        blockedAt: isBlocking ? new Date() : null,
        blockedById: isBlocking ? actor.userId : null,
      },
      omit: { password: true },
    });

    // a blocked user is signed out everywhere
    if (isBlocking) {
      await revokeAllUserRefreshTokens(id, tx);
    }

    await createAuditLog(
      {
        userId: actor.userId,
        action: AuditAction.UPDATE,
        entity: "User",
        entityId: id,
        oldData: { status: target.status },
        newData: { status: payload.status, reason: payload.reason ?? null },
        ...meta,
      },
      tx,
    );

    return updatedUser;
  });
};

const updateUserRole = async (
  actor: RequestUser,
  id: string,
  payload: IUpdateUserRolePayload,
  meta: IRequestMeta,
) => {
  const target = await findUserOrThrow(id);

  assertCanManageUser(actor, target);

  if (!canCreateRole(actor.role, payload.role)) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      `You are not allowed to assign the ${payload.role} role`,
    );
  }

  if (target.role === payload.role) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `User already has the ${payload.role} role`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id },
      data: { role: payload.role },
      omit: { password: true },
    });

    // the role lives in the JWT, so existing sessions must log in again
    await revokeAllUserRefreshTokens(id, tx);

    await createAuditLog(
      {
        userId: actor.userId,
        action: AuditAction.UPDATE,
        entity: "User",
        entityId: id,
        oldData: { role: target.role },
        newData: { role: payload.role },
        ...meta,
      },
      tx,
    );

    return updatedUser;
  });
};

const deleteUser = async (
  actor: RequestUser,
  id: string,
  meta: IRequestMeta,
) => {
  const target = await findUserOrThrow(id);

  assertCanManageUser(actor, target);

  if (target.isDeleted) {
    throw new AppError(httpStatus.BAD_REQUEST, "User is already deleted");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        isDeleted: true,
        status: UserStatus.INACTIVE,
        deletedAt: new Date(),
      },
      omit: { password: true },
    });

    await revokeAllUserRefreshTokens(id, tx);

    await createAuditLog(
      {
        userId: actor.userId,
        action: AuditAction.DELETE,
        entity: "User",
        entityId: id,
        ...meta,
      },
      tx,
    );

    return user;
  });
};

const restoreUser = async (
  actor: RequestUser,
  id: string,
  meta: IRequestMeta,
) => {
  const target = await findUserOrThrow(id);

  assertCanManageUser(actor, target);

  if (!target.isDeleted) {
    throw new AppError(httpStatus.BAD_REQUEST, "User is not deleted");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        isDeleted: false,
        status: UserStatus.ACTIVE,
        deletedAt: null,
      },
      omit: { password: true },
    });

    await createAuditLog(
      {
        userId: actor.userId,
        action: AuditAction.UPDATE,
        entity: "User",
        entityId: id,
        newData: { restored: true },
        ...meta,
      },
      tx,
    );

    return user;
  });
};

export const UserService = {
  getMyProfile,
  updateMyProfile,
  deleteMyAccount,
  createUser,
  getAllUsers,
  getUserById,
  updateUserStatus,
  updateUserRole,
  deleteUser,
  restoreUser,
};
