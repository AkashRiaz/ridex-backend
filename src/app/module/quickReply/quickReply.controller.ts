import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { QuickReplyService } from "./quickReply.service";
import { QuickReplyParamZodSchema } from "./quickReply.validation";

const parseId = (req: Request) => {
  const result = QuickReplyParamZodSchema.safeParse(req.params);

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid quick reply ID");
  }

  return result.data.id;
};

const getQuickReplies = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await QuickReplyService.getQuickReplies(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Quick replies retrieved successfully",
    data: result,
  });
});

const createQuickReply = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await QuickReplyService.createQuickReply(userId, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Quick reply saved",
    data: result,
  });
});

const updateQuickReply = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await QuickReplyService.updateQuickReply(
    userId,
    parseId(req),
    req.body,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Quick reply updated",
    data: result,
  });
});

const deleteQuickReply = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await QuickReplyService.deleteQuickReply(userId, parseId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Quick reply deleted",
    data: result,
  });
});

export const QuickReplyController = {
  getQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
};
