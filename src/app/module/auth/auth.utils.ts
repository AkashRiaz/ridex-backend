import crypto from "crypto";
import { CookieOptions, Request, Response } from "express";
import httpStatus from "http-status";
import jwt, { SignOptions } from "jsonwebtoken";
import { Prisma } from "../../../generated/prisma/client";
import { UserStatus } from "../../../generated/prisma/enums";
import { config } from "../../config";
import { normalizePhone } from "../../helper/normalizePhone";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { SOCKET_TOKEN_TYPE } from "../../lib/socket";
import { AppError } from "../../utils/AppError";
import { hashToken } from "../../utils/hashToken";
import { jwtUtils } from "../../utils/jwt";
import { IRequestMeta, TPhoneOtpPurpose } from "./auth.interface";

type TUser = Prisma.UserGetPayload<object>;

// ============================================
// Redis OTP keys
// ============================================

export const otpKeys = {
  emailVerification: (email: string) => `email-verification-otp:${email}`,
  phone: (purpose: TPhoneOtpPurpose, phone: string) =>
    `phone-otp:${purpose.toLowerCase()}:${phone}`,
  forgotPassword: (identifier: string) => `forgot-password-otp:${identifier}`,
};

// ============================================
// OTP
// ============================================

export const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

/*
 * Stores a new OTP. Throws 429 while the resend cooldown is active.
 */
export const storeOtp = async (key: string) => {
  const cooldownKey = `${key}:cooldown`;

  const cooldownTTL = await redisClient.ttl(cooldownKey);

  if (cooldownTTL > 0) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      `Please wait ${cooldownTTL} seconds before requesting a new code`,
    );
  }

  const otp = generateOtp();
  const expirationSeconds = config.otp_expires_minutes * 60;

  await redisClient.set(key, otp, {
    expiration: { type: "EX", value: expirationSeconds },
  });

  await redisClient.del([`${key}:attempts`]);

  await redisClient.set(cooldownKey, "1", {
    expiration: { type: "EX", value: config.otp_resend_cooldown_seconds },
  });

  return { otp, expirationMinutes: config.otp_expires_minutes };
};

/*
 * Verifies and consumes an OTP. After too many wrong tries the OTP is destroyed.
 */
export const verifyOtp = async (key: string, otp: string) => {
  const attemptsKey = `${key}:attempts`;

  const storedOtp = await redisClient.get(key);

  if (!storedOtp) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP has expired or is invalid");
  }

  const isMatch =
    storedOtp.length === otp.length &&
    crypto.timingSafeEqual(Buffer.from(storedOtp), Buffer.from(otp));

  if (!isMatch) {
    const attempts = await redisClient.incr(attemptsKey);

    await redisClient.expire(attemptsKey, config.otp_expires_minutes * 60);

    if (attempts >= config.otp_max_attempts) {
      await redisClient.del([key, attemptsKey]);

      throw new AppError(
        httpStatus.TOO_MANY_REQUESTS,
        "Too many wrong attempts. Please request a new code.",
      );
    }

    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  await redisClient.del([key, attemptsKey]);
};

// ============================================
// Identifier (email or phone)
// ============================================

export const resolveIdentifier = (
  identifier: string,
): { email: string } | { phone: string } => {
  const value = identifier.trim();

  if (value.includes("@")) {
    return { email: value.toLowerCase() };
  }

  const phone = normalizePhone(value);

  if (!phone) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Enter a valid email address or Bangladeshi mobile number",
    );
  }

  return { phone };
};

export const findUserByIdentifier = (identifier: string) =>
  prisma.user.findUnique({
    where: resolveIdentifier(identifier),
  });

// ============================================
// Account state checks
// ============================================

export const assertUserCanAuthenticate = (user: TUser | null): TUser => {
  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.isDeleted) {
    throw new AppError(httpStatus.FORBIDDEN, "User is deleted");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Your account has been blocked. Please contact support.",
    );
  }

  if (user.status === UserStatus.INACTIVE) {
    throw new AppError(httpStatus.FORBIDDEN, "Your account is inactive");
  }

  return user;
};

export const sanitizeUser = <T extends { password?: string | null }>(
  user: T,
) => {
  const { password: _password, ...userWithoutPassword } = user;

  return userWithoutPassword;
};

// ============================================
// Tokens
// ============================================

export const createJwtPayload = (user: TUser) => ({
  userId: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  // password version: tokens issued before a password change stop working
  pwdAt: user.passwordChangedAt?.getTime() ?? null,
});

/*
 * Creates an access + refresh token pair and stores the hashed refresh
 * token. The DB expiry is taken from the JWT itself (single source of truth).
 */
export const generateAuthTokens = async (
  user: TUser,
  meta: IRequestMeta = {},
  tx?: Prisma.TransactionClient,
) => {
  const jwtPayload = createJwtPayload(user);

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    { ...jwtPayload, jti: crypto.randomUUID() },
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  const decodedRefreshToken = jwt.decode(refreshToken) as { exp: number };

  await (tx ?? prisma).refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: new Date(decodedRefreshToken.exp * 1000),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
    },
  });

  return { accessToken, refreshToken };
};

/*
 * Short-lived token for the Socket.io handshake only. Signed with
 * JWT_SOCKET_SECRET, so REST auth() never accepts it.
 */
export const createSocketToken = (user: TUser) =>
  jwtUtils.createToken(
    { ...createJwtPayload(user), typ: SOCKET_TOKEN_TYPE },
    config.jwt_socket_secret,
    config.socket_token_expires_in as SignOptions,
  );

export const revokeAllUserRefreshTokens = (
  userId: string,
  tx?: Prisma.TransactionClient,
) =>
  (tx ?? prisma).refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

// ============================================
// Cookies
// ============================================

const ACCESS_TOKEN_MAX_AGE = 1000 * 60 * 60 * 24; // 1 day
const REFRESH_TOKEN_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days

const baseCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure:
    config.node_env === "production" || config.cookie_same_site === "none",
  sameSite: config.cookie_same_site,
  domain: config.cookie_domain,
  path: "/",
});

export const setAuthCookies = (
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) => {
  res.cookie("accessToken", tokens.accessToken, {
    ...baseCookieOptions(),
    maxAge: ACCESS_TOKEN_MAX_AGE,
  });

  res.cookie("refreshToken", tokens.refreshToken, {
    ...baseCookieOptions(),
    maxAge: REFRESH_TOKEN_MAX_AGE,
  });
};

export const clearAuthCookies = (res: Response) => {
  res.clearCookie("accessToken", baseCookieOptions());
  res.clearCookie("refreshToken", baseCookieOptions());
};

export const getRequestMeta = (req: Request): IRequestMeta => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get("user-agent") ?? null,
});

/*
 * The Next frontend forwards the refresh token as a cookie;
 * other clients (mobile) may send it in the body.
 */
export const getRefreshTokenFromRequest = (req: Request): string | undefined => {
  const cookieToken = req.cookies?.refreshToken;

  if (typeof cookieToken === "string" && cookieToken.trim()) {
    return cookieToken.trim();
  }

  const bodyToken = req.body?.refreshToken;

  return typeof bodyToken === "string" && bodyToken.trim()
    ? bodyToken.trim()
    : undefined;
};
