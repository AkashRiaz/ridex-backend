import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { NotificationService } from "./notification.service";
import { NotificationParamZodSchema } from "./notification.validation";

const parseId = (req: Request) => {
  const result = NotificationParamZodSchema.safeParse(req.params);

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid notification ID");
  }

  return result.data.id;
};

const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.getMyNotifications(
    userId,
    req.query,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notifications retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.getUnreadCount(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Unread count retrieved successfully",
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.markAsRead(userId, parseId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notification marked as read",
    data: result,
  });
});

const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.markAllAsRead(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "All notifications marked as read",
    data: result,
  });
});

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.deleteNotification(
    userId,
    parseId(req),
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notification removed",
    data: result,
  });
});

const getMyPreferences = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.getMyPreferences(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notification preferences retrieved successfully",
    data: result,
  });
});

const updateMyPreferences = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await NotificationService.updateMyPreferences(
    userId,
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Notification preferences updated",
    data: result,
  });
});

const unsubscribe = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationService.unsubscribe(req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "You have been unsubscribed from these emails",
    data: result,
  });
});

export const NotificationController = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getMyPreferences,
  updateMyPreferences,
  unsubscribe,
};
