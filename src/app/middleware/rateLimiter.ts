import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import { config } from "../config";

const rateLimitResponse = (message: string) => ({
  success: false,
  statusCode: httpStatus.TOO_MANY_REQUESTS,
  message,
});

export const globalRateLimiter = rateLimit({
  windowMs: config.rate_limit_window_minutes * 60 * 1000,
  limit: config.rate_limit_max,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitResponse("Too many requests. Please try again later."),
});

/*
 * For login, OTP, forgot-password and other sensitive endpoints.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: rateLimitResponse(
    "Too many attempts. Please wait 15 minutes and try again.",
  ),
});
