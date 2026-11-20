import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { UserStatus } from "../../generated/prisma/enums";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { catchAsync } from "../utils/catchAsync";
import { jwtUtils } from "../utils/jwt";

/*
 * For public routes that behave differently for signed-in users
 * (e.g. owners previewing their own unapproved listing).
 * Sets req.user when a valid token is sent; never rejects the request.
 */
export const optionalAuth = () =>
  catchAsync(async (req: Request, _res: Response, next: NextFunction) => {
    const authorization = req.headers.authorization?.trim();
    const token =
      (authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined) ||
      (typeof req.cookies?.accessToken === "string" ? req.cookies.accessToken.trim() : undefined);

    if (!token) return next();

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

    if (!verifiedToken.success) return next();

    const { userId, pwdAt } = verifiedToken.data as JwtPayload;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (
      user &&
      !user.isDeleted &&
      user.status !== UserStatus.BLOCKED &&
      (user.passwordChangedAt?.getTime() ?? null) === (pwdAt ?? null)
    ) {
      req.user = {
        email: user.email,
        name: user.name,
        userId: user.id,
        role: user.role,
      };
    }

    next();
  });
