import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { authRateLimiter } from "../../middleware/rateLimiter";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import {
  ChangePasswordZodSchema,
  EmailVerifyZodSchema,
  ForgotPasswordZodSchema,
  GoogleLoginZodSchema,
  LoginZodSchema,
  RegisterZodSchema,
  ResendEmailOtpZodSchema,
  ResetPasswordZodSchema,
  SendPhoneOtpZodSchema,
  VerifyPhoneOtpZodSchema,
} from "./auth.validation";

const router = Router();

router.post(
  "/register",
  authRateLimiter,
  validateRequest(RegisterZodSchema),
  AuthController.registerUser,
);

router.post(
  "/verify-email",
  authRateLimiter,
  validateRequest(EmailVerifyZodSchema),
  AuthController.verifyEmail,
);

router.post(
  "/resend-email-otp",
  authRateLimiter,
  validateRequest(ResendEmailOtpZodSchema),
  AuthController.resendEmailVerificationOtp,
);

router.post(
  "/phone-otp/send",
  authRateLimiter,
  validateRequest(SendPhoneOtpZodSchema),
  AuthController.sendPhoneOtp,
);

router.post(
  "/phone-otp/verify",
  authRateLimiter,
  validateRequest(VerifyPhoneOtpZodSchema),
  AuthController.verifyPhoneOtp,
);

router.post(
  "/login",
  authRateLimiter,
  validateRequest(LoginZodSchema),
  AuthController.loginUser,
);

router.post(
  "/google",
  authRateLimiter,
  validateRequest(GoogleLoginZodSchema),
  AuthController.googleLogin,
);

router.post("/refresh-token", AuthController.refreshToken);

router.post("/logout", AuthController.logout);

router.get("/me", auth(), AuthController.getMe);

router.post("/socket-token", auth(), AuthController.getSocketToken);

router.post(
  "/change-password",
  auth(),
  validateRequest(ChangePasswordZodSchema),
  AuthController.changePassword,
);

router.post(
  "/forgot-password",
  authRateLimiter,
  validateRequest(ForgotPasswordZodSchema),
  AuthController.forgotPassword,
);

router.post(
  "/reset-password",
  authRateLimiter,
  validateRequest(ResetPasswordZodSchema),
  AuthController.resetPassword,
);

export const AuthRoutes = router;
