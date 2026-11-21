import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import httpStatus from "http-status";
import { Role, UserStatus } from "../../generated/prisma/enums";
import { catchAsync } from "../utils/catchAsync";
import { jwtUtils } from "../utils/jwt";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "../utils/AppError";

export interface RequestUser {
  email: string | null;
  name: string;
  userId: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

/*
 * Shared by auth() (REST) and the Socket.io handshake (lib/socket.ts):
 * the token's user must still exist, keep the same role, not be blocked,
 * and not have changed their password since the token was issued.
 */
export const loadAuthUser = async (claims: {
  userId: string;
  role?: Role;
  pwdAt?: number | null;
}): Promise<RequestUser> => {
  /*
   * Look up by id only, so name/email changes
   * do not invalidate a valid token.
   */
  const user = await prisma.user.findUnique({
    where: {
      id: claims.userId,
    },
  });

  if (!user || user.isDeleted) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "User not found. Please log in again.",
    );
  }

  if (user.role !== claims.role) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Your role has changed. Please log in again.",
    );
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Your account has been blocked. Please contact support.",
    );
  }

  /*
   * Tokens issued before a password change are rejected:
   * the token's password version must match the user's.
   */
  if ((user.passwordChangedAt?.getTime() ?? null) !== (claims.pwdAt ?? null)) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Password was changed recently. Please log in again.",
    );
  }

  return {
    email: user.email,
    name: user.name,
    userId: user.id,
    role: user.role,
  };
};

// auth(Role.ADMIN, Role.SELLER)
// auth() => any logged-in user
export const auth = (...requiredRoles: Role[]) => {
  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const authorization = req.headers.authorization?.trim();
    const bearerToken = authorization?.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : undefined;
    const cookieToken =
      typeof req.cookies?.accessToken === "string"
        ? req.cookies.accessToken.trim()
        : undefined;
    const token = bearerToken || cookieToken;

    if (!token) {
      throw new AppError(
        httpStatus.UNAUTHORIZED,
        "You are not logged in. Please log in to access this resource.",
      );
    }

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

    if (!verifiedToken.success) {
      throw new AppError(
        httpStatus.UNAUTHORIZED,
        "Invalid or expired access token. Please log in again.",
      );
    }

    const { userId, role, pwdAt } = verifiedToken.data as JwtPayload;

    if (requiredRoles.length && !requiredRoles.includes(role)) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "Forbidden. You don't have permission to access this resource.",
      );
    }

    req.user = await loadAuthUser({ userId, role, pwdAt });

    next();
  });
};
