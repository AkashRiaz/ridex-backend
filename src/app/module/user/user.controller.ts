import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { clearAuthCookies, getRequestMeta } from "../auth/auth.utils";
import { UserService } from "./user.service";

const getMyProfile = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await UserService.getMyProfile(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Your profile retrieved successfully",
    data: result,
  });
});

const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const files = req.files as {
    avatar?: Express.Multer.File[];
  };

  const avatar = files?.avatar?.[0] ?? null;

  const result = await UserService.updateMyProfile(userId, req.body, avatar);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Your profile updated successfully",
    data: result,
  });
});

const deleteMyAccount = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  await UserService.deleteMyAccount(userId, req.body, getRequestMeta(req));

  clearAuthCookies(res);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Your account has been deleted",
    data: null,
  });
});

const createUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.createUser(
    req.user as RequestUser,
    req.body,
    getRequestMeta(req),
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "User created successfully and login details sent by email",
    data: result,
  });
});

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserService.getAllUsers(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Users retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getUserById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await UserService.getUserById(id as string);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User retrieved successfully",
    data: result,
  });
});

const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await UserService.updateUserStatus(
    req.user as RequestUser,
    id as string,
    req.body,
    getRequestMeta(req),
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message:
      result.status === "BLOCKED"
        ? "User blocked successfully"
        : "User activated successfully",
    data: result,
  });
});

const updateUserRole = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await UserService.updateUserRole(
    req.user as RequestUser,
    id as string,
    req.body,
    getRequestMeta(req),
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User role updated successfully",
    data: result,
  });
});

const deleteUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await UserService.deleteUser(
    req.user as RequestUser,
    id as string,
    getRequestMeta(req),
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User deleted successfully",
    data: result,
  });
});

const restoreUser = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await UserService.restoreUser(
    req.user as RequestUser,
    id as string,
    getRequestMeta(req),
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User restored successfully",
    data: result,
  });
});

export const UserController = {
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
