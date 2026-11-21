import bcrypt from "bcrypt";
import httpStatus from "http-status";
import { TokenPayload } from "google-auth-library";
import {
  AuditAction,
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import { config } from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { prisma } from "../../lib/prisma";
import { smsClient } from "../../lib/sms";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog } from "../../utils/auditLogger";
import { hashToken } from "../../utils/hashToken";
import { jwtUtils } from "../../utils/jwt";
import { sendEmail } from "../../utils/sendEmail";
import {
  IChangePasswordPayload,
  IForgotPasswordPayload,
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPayload,
  IRequestMeta,
  IResendEmailOtpPayload,
  IResetPasswordPayload,
  ISendPhoneOtpPayload,
  IVerifyEmailPayload,
  IVerifyPhoneOtpPayload,
} from "./auth.interface";
import {
  assertUserCanAuthenticate,
  createSocketToken,
  findUserByIdentifier,
  generateAuthTokens,
  otpKeys,
  resolveIdentifier,
  revokeAllUserRefreshTokens,
  sanitizeUser,
  storeOtp,
  verifyOtp,
} from "./auth.utils";

const hashPassword = (password: string) =>
  bcrypt.hash(password, Number(config.bcrypt_salt_rounds));

// ============================================
// OTP senders (side effects)
// ============================================

const sendEmailVerificationOtp = async (email: string, name: string) => {
  const { otp, expirationMinutes } = await storeOtp(
    otpKeys.emailVerification(email),
  );

  await sendEmail({
    to: email,
    subject: `Verify your ${config.app_name} email`,
    template: "verify-email-otp",
    data: { name, otp, expirationMinutes },
  });
};

const sendPhoneOtpSms = async (
  phone: string,
  purpose: ISendPhoneOtpPayload["purpose"],
) => {
  const { otp, expirationMinutes } = await storeOtp(
    otpKeys.phone(purpose, phone),
  );

  await smsClient.send(
    phone,
    `${otp} is your ${config.app_name} ${
      purpose === "LOGIN" ? "login" : "verification"
    } code. It expires in ${expirationMinutes} minutes. Do not share it.`,
  );
};

// ============================================
// Register & verification
// ============================================

const registerUser = async (payload: IRegisterPayload) => {
  const { name, email, phone, password, role } = payload;

  if (email) {
    const existingEmail = await prisma.user.findUnique({ where: { email } });

    if (existingEmail) {
      throw new AppError(
        httpStatus.CONFLICT,
        "User with this email already exists",
      );
    }
  }

  if (phone) {
    const existingPhone = await prisma.user.findUnique({ where: { phone } });

    if (existingPhone) {
      throw new AppError(
        httpStatus.CONFLICT,
        "User with this phone number already exists",
      );
    }
  }

  const hashedPassword = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      name,
      email: email ?? null,
      phone: phone ?? null,
      password: hashedPassword,
      role,
      authProvider: email ? AuthProvider.CREDENTIALS : AuthProvider.PHONE,
      // dealers stay PENDING until the verification module approves them
      status: role === Role.DEALER ? UserStatus.PENDING : UserStatus.ACTIVE,
      emailVerified: false,
      phoneVerified: false,
    },
    omit: { password: true },
  });

  // Side effects AFTER commit — send verification codes
  if (user.email) {
    await sendEmailVerificationOtp(user.email, user.name);
  }

  if (user.phone) {
    await sendPhoneOtpSms(user.phone, "VERIFY");
  }

  return {
    user,
    verification: {
      email: Boolean(user.email),
      phone: Boolean(user.phone),
    },
  };
};

const verifyEmail = async (payload: IVerifyEmailPayload, meta: IRequestMeta) => {
  const { email, otp } = payload;

  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: { email } }),
  );

  if (user.emailVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Email is already verified");
  }

  await verifyOtp(otpKeys.emailVerification(email), otp);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true, lastLoginAt: new Date() },
  });

  const tokens = await generateAuthTokens(updatedUser, meta);

  return { user: sanitizeUser(updatedUser), ...tokens };
};

const resendEmailVerificationOtp = async (payload: IResendEmailOtpPayload) => {
  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: { email: payload.email } }),
  );

  if (user.emailVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Email is already verified");
  }

  await sendEmailVerificationOtp(payload.email, user.name);
};

const sendPhoneOtp = async (payload: ISendPhoneOtpPayload) => {
  const { phone, purpose } = payload;

  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: { phone } }),
  );

  if (purpose === "VERIFY" && user.phoneVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Phone is already verified");
  }

  if (purpose === "LOGIN" && !user.phoneVerified) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Please verify your phone number before logging in with OTP",
    );
  }

  await sendPhoneOtpSms(phone, purpose);
};

/*
 * VERIFY → marks the phone as verified and signs the user in.
 * LOGIN  → passwordless sign-in with a verified phone.
 */
const verifyPhoneOtp = async (
  payload: IVerifyPhoneOtpPayload,
  meta: IRequestMeta,
) => {
  const { phone, otp, purpose } = payload;

  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: { phone } }),
  );

  if (purpose === "VERIFY" && user.phoneVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "Phone is already verified");
  }

  if (purpose === "LOGIN" && !user.phoneVerified) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Please verify your phone number before logging in with OTP",
    );
  }

  await verifyOtp(otpKeys.phone(purpose, phone), otp);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      ...(purpose === "VERIFY" && { phoneVerified: true }),
      lastLoginAt: new Date(),
    },
  });

  const tokens = await generateAuthTokens(updatedUser, meta);

  if (purpose === "LOGIN") {
    await createAuditLog({
      userId: updatedUser.id,
      action: AuditAction.LOGIN,
      entity: "User",
      entityId: updatedUser.id,
      newData: { method: "PHONE_OTP" },
      ...meta,
    });
  }

  return { user: sanitizeUser(updatedUser), ...tokens };
};

// ============================================
// Login
// ============================================

const loginUser = async (payload: ILoginUserPayload, meta: IRequestMeta) => {
  const user = assertUserCanAuthenticate(
    await findUserByIdentifier(payload.identifier),
  );

  if (!user.password) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      user.googleId
        ? "This account uses Google login. Please continue with Google."
        : "This account has no password. Please log in with a phone OTP.",
    );
  }

  const isPasswordMatched = await bcrypt.compare(
    payload.password,
    user.password,
  );

  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
  }

  // Gate: at least one verified contact (email or phone)
  if (!user.emailVerified && !user.phoneVerified) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Please verify your email or phone first. Check your inbox or SMS for the code.",
    );
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const tokens = await generateAuthTokens(updatedUser, meta);

  await createAuditLog({
    userId: updatedUser.id,
    action: AuditAction.LOGIN,
    entity: "User",
    entityId: updatedUser.id,
    newData: { method: "PASSWORD" },
    ...meta,
  });

  return { user: sanitizeUser(updatedUser), ...tokens };
};

const googleLogin = async (payload: IGoogleLoginPayload, meta: IRequestMeta) => {
  if (!config.enable_google_login || !config.google_client_id) {
    throw new AppError(httpStatus.NOT_FOUND, "Google login is not enabled");
  }

  let googleIdTokenPayload: TokenPayload | undefined;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: payload.idToken,
      audience: config.google_client_id,
    });
    googleIdTokenPayload = ticket.getPayload();
  } catch (error) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      config.node_env === "development"
        ? `Google login failed: ${error}`
        : "Google login failed",
    );
  }

  if (!googleIdTokenPayload?.email || !googleIdTokenPayload.email_verified) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Unable to retrieve a verified email from Google",
    );
  }

  const email = googleIdTokenPayload.email.trim().toLowerCase();
  const googleId = googleIdTokenPayload.sub;

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId }, { email }] },
  });

  if (user) {
    assertUserCanAuthenticate(user);

    if (user.googleId && user.googleId !== googleId) {
      throw new AppError(
        httpStatus.CONFLICT,
        "This account is linked to a different Google account",
      );
    }

    // Link Google + verify email in one update
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        googleId,
        emailVerified: true,
        lastLoginAt: new Date(),
        ...(!user.imageUrl &&
          googleIdTokenPayload.picture && {
            imageUrl: googleIdTokenPayload.picture,
          }),
      },
    });
  } else {
    // New marketplace users from Google become buyers
    user = await prisma.user.create({
      data: {
        name: googleIdTokenPayload.name || email.split("@")[0],
        email,
        googleId,
        authProvider: AuthProvider.GOOGLE,
        role: Role.BUYER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        imageUrl: googleIdTokenPayload.picture ?? null,
        lastLoginAt: new Date(),
      },
    });
  }

  const tokens = await generateAuthTokens(user, meta);

  await createAuditLog({
    userId: user.id,
    action: AuditAction.LOGIN,
    entity: "User",
    entityId: user.id,
    newData: { method: "GOOGLE" },
    ...meta,
  });

  return { user: sanitizeUser(user), ...tokens };
};

// ============================================
// Tokens
// ============================================

const refreshToken = async (token: string, meta: IRequestMeta) => {
  if (!token) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is required");
  }

  // 1. Verify JWT
  const verifiedToken = jwtUtils.verifyToken(token, config.jwt_refresh_secret);

  if (!verifiedToken.success) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Invalid or expired refresh token",
    );
  }

  // 2. Find hashed token in database
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!storedToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token not found");
  }

  // 3. Reuse of a revoked token = likely theft → revoke every session
  if (storedToken.revokedAt) {
    await revokeAllUserRefreshTokens(storedToken.userId);

    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Refresh token has been revoked. Please log in again.",
    );
  }

  // 4. Check database expiration
  if (storedToken.expiresAt <= new Date()) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token has expired");
  }

  // 5. Check user
  const user = assertUserCanAuthenticate(storedToken.user);

  // 6. Rotate: revoke old + issue new pair
  return prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return generateAuthTokens(user, meta, tx);
  });
};

const logout = async (token: string | undefined, meta: IRequestMeta) => {
  if (!token) return;

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (storedToken && !storedToken.revokedAt) {
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    await createAuditLog({
      userId: storedToken.userId,
      action: AuditAction.LOGOUT,
      entity: "User",
      entityId: storedToken.userId,
      ...meta,
    });
  }
};

const getMe = async (user: RequestUser) => {
  const isUserExist = await prisma.user.findUnique({
    where: { id: user.userId },
    omit: { password: true },
  });

  if (!isUserExist) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return isUserExist;
};

const getSocketToken = async (user: RequestUser) => {
  const isUserExist = await prisma.user.findUnique({ where: { id: user.userId } });

  if (!isUserExist) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return {
    token: createSocketToken(isUserExist),
    expiresIn: config.socket_token_expires_in,
  };
};

// ============================================
// Passwords
// ============================================

const changePassword = async (
  requestUser: RequestUser,
  payload: IChangePasswordPayload,
  meta: IRequestMeta,
) => {
  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: { id: requestUser.userId } }),
  );

  if (user.password) {
    if (!payload.oldPassword) {
      throw new AppError(httpStatus.BAD_REQUEST, "Current password is required");
    }

    const isPasswordMatched = await bcrypt.compare(
      payload.oldPassword,
      user.password,
    );

    if (!isPasswordMatched) {
      throw new AppError(
        httpStatus.UNAUTHORIZED,
        "Current password is incorrect",
      );
    }
  }

  const hashedNewPassword = await hashPassword(payload.newPassword);

  /*
   * Every existing session is revoked and old access tokens stop
   * working (checkAuth compares passwordChangedAt with iat).
   * A fresh pair is issued for the current device.
   */
  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        password: hashedNewPassword,
        passwordChangedAt: new Date(),
        needPasswordChange: false,
      },
    });

    await revokeAllUserRefreshTokens(user.id, tx);

    const tokens = await generateAuthTokens(updatedUser, meta, tx);

    await createAuditLog(
      {
        userId: user.id,
        action: AuditAction.UPDATE,
        entity: "User",
        entityId: user.id,
        newData: { field: "password" },
        ...meta,
      },
      tx,
    );

    return { user: sanitizeUser(updatedUser), ...tokens };
  });

  // Side effects AFTER commit
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: "Password Changed",
      template: "password-changed",
      data: { name: user.name },
    }).catch((error) => console.error("Password changed email failed:", error));
  }

  return result;
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
  const identifier = resolveIdentifier(payload.identifier);

  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: identifier }),
  );

  const isEmail = "email" in identifier;

  if (isEmail && !user.emailVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "User email is not verified");
  }

  if (!isEmail && !user.phoneVerified) {
    throw new AppError(httpStatus.BAD_REQUEST, "User phone is not verified");
  }

  const identifierValue = isEmail ? identifier.email : identifier.phone;

  const { otp, expirationMinutes } = await storeOtp(
    otpKeys.forgotPassword(identifierValue),
  );

  if (isEmail) {
    await sendEmail({
      to: identifier.email,
      subject: "Forgot Password OTP",
      template: "forgot-password-otp",
      data: { name: user.name, otp, expirationMinutes },
    });
  } else {
    await smsClient.send(
      identifier.phone,
      `${otp} is your ${config.app_name} password reset code. It expires in ${expirationMinutes} minutes.`,
    );
  }

  return { channel: isEmail ? "EMAIL" : "PHONE" };
};

const resetPassword = async (
  payload: IResetPasswordPayload,
  meta: IRequestMeta,
) => {
  const identifier = resolveIdentifier(payload.identifier);

  const user = assertUserCanAuthenticate(
    await prisma.user.findUnique({ where: identifier }),
  );

  const identifierValue = "email" in identifier ? identifier.email : identifier.phone;

  await verifyOtp(otpKeys.forgotPassword(identifierValue), payload.otp);

  const hashedNewPassword = await hashPassword(payload.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        password: hashedNewPassword,
        passwordChangedAt: new Date(),
        needPasswordChange: false,
      },
    });

    await revokeAllUserRefreshTokens(user.id, tx);

    await createAuditLog(
      {
        userId: user.id,
        action: AuditAction.UPDATE,
        entity: "User",
        entityId: user.id,
        newData: { field: "password", method: "RESET" },
        ...meta,
      },
      tx,
    );
  });

  // Side effects AFTER commit
  if (user.email) {
    await sendEmail({
      to: user.email,
      subject: "Password Changed",
      template: "password-changed",
      data: { name: user.name },
    }).catch((error) => console.error("Password changed email failed:", error));
  }
};

export const AuthService = {
  registerUser,
  verifyEmail,
  resendEmailVerificationOtp,
  sendPhoneOtp,
  verifyPhoneOtp,
  loginUser,
  googleLogin,
  refreshToken,
  logout,
  getMe,
  getSocketToken,
  changePassword,
  forgotPassword,
  resetPassword,
};
