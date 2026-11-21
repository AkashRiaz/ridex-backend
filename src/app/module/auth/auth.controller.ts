import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AuthService } from "./auth.service";
import {
  clearAuthCookies,
  getRefreshTokenFromRequest,
  getRequestMeta,
  setAuthCookies,
} from "./auth.utils";

const registerUser = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.registerUser(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message:
      "Account created successfully. Please verify your account with the code we sent you.",
    data: result,
  });
});

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await AuthService.verifyEmail(
    req.body,
    getRequestMeta(req),
  );

  setAuthCookies(res, { accessToken, refreshToken });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Email Verified Successfully",
    data: { accessToken, refreshToken, user },
  });
});

const resendEmailVerificationOtp = catchAsync(
  async (req: Request, res: Response) => {
    await AuthService.resendEmailVerificationOtp(req.body);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Verification code sent successfully",
      data: null,
    });
  },
);

const sendPhoneOtp = catchAsync(async (req: Request, res: Response) => {
  await AuthService.sendPhoneOtp(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent to your phone successfully",
    data: null,
  });
});

const verifyPhoneOtp = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await AuthService.verifyPhoneOtp(
    req.body,
    getRequestMeta(req),
  );

  setAuthCookies(res, { accessToken, refreshToken });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      req.body.purpose === "LOGIN"
        ? "Logged in successfully"
        : "Phone Verified Successfully",
    data: { accessToken, refreshToken, user },
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await AuthService.loginUser(
    req.body,
    getRequestMeta(req),
  );

  setAuthCookies(res, { accessToken, refreshToken });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged in successfully",
    data: { accessToken, refreshToken, user },
  });
});

const googleLogin = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await AuthService.googleLogin(
    req.body,
    getRequestMeta(req),
  );

  setAuthCookies(res, { accessToken, refreshToken });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logged in with Google successfully",
    data: { accessToken, refreshToken, user },
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token = getRefreshTokenFromRequest(req);

  if (!token) {
    clearAuthCookies(res);

    return sendResponse(res, {
      statusCode: httpStatus.UNAUTHORIZED,
      success: false,
      message: "Refresh token is missing",
      data: null,
    });
  }

  const { accessToken, refreshToken: newRefreshToken } =
    await AuthService.refreshToken(token, getRequestMeta(req));

  setAuthCookies(res, { accessToken, refreshToken: newRefreshToken });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "New tokens generated successfully",
    data: { accessToken, refreshToken: newRefreshToken },
  });
});

const logout = catchAsync(async (req: Request, res: Response) => {
  await AuthService.logout(getRefreshTokenFromRequest(req), getRequestMeta(req));

  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Logout successful",
    data: null,
  });
});

const getMe = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.getMe(req.user as RequestUser);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User data retrieved successfully",
    data: result,
  });
});

const getSocketToken = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.getSocketToken(req.user as RequestUser);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Socket token issued",
    data: result,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await AuthService.changePassword(
    req.user as RequestUser,
    req.body,
    getRequestMeta(req),
  );

  setAuthCookies(res, { accessToken, refreshToken });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password changed successfully",
    data: { accessToken, refreshToken, user },
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.forgotPassword(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      result.channel === "EMAIL"
        ? "Password reset code sent to your email"
        : "Password reset code sent to your phone",
    data: result,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await AuthService.resetPassword(req.body, getRequestMeta(req));

  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully. Please log in.",
    data: null,
  });
});

export const AuthController = {
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
