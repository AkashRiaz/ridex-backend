import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserBlockService } from "./userBlock.service";
import { UserBlockParamZodSchema } from "./userBlock.validation";

const parseUserId = (req: Request) => {
  const result = UserBlockParamZodSchema.safeParse(req.params);

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid user ID");
  }

  return result.data.userId;
};

const blockUser = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await UserBlockService.blockUser(userId, parseUserId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "User blocked",
    data: result,
  });
});

const unblockUser = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await UserBlockService.unblockUser(userId, parseUserId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "User unblocked",
    data: result,
  });
});

const getMyBlockedUsers = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await UserBlockService.getMyBlockedUsers(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Blocked users retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const UserBlockController = {
  blockUser,
  unblockUser,
  getMyBlockedUsers,
};
