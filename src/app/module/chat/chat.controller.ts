import { Request, Response } from "express";
import httpStatus from "http-status";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ChatService } from "./chat.service";
import { ConversationParamZodSchema, MessagesQueryZodSchema } from "./chat.validation";

const parseConversationId = (req: Request) => {
  const result = ConversationParamZodSchema.safeParse(req.params);

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid conversation ID");
  }

  return result.data.id;
};

const startConversation = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.startConversation(req.user as RequestUser, req.body);

  sendResponse(res, {
    success: true,
    statusCode: result.created ? httpStatus.CREATED : httpStatus.OK,
    message: result.created ? "Conversation started" : "Message sent",
    data: result,
  });
});

const getMyConversations = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ChatService.getMyConversations(userId, req.query);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Conversations retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ChatService.getUnreadCount(userId);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Unread count retrieved successfully",
    data: result,
  });
});

const getConversationById = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ChatService.getConversationById(userId, parseConversationId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Conversation retrieved successfully",
    data: result,
  });
});

const getMessages = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const query = MessagesQueryZodSchema.safeParse(req.query);

  if (!query.success) {
    throw new AppError(httpStatus.BAD_REQUEST, query.error.issues.map((issue) => issue.message).join(", "));
  }

  const result = await ChatService.getMessages(userId, parseConversationId(req), query.data);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Messages retrieved successfully",
    data: result.data,
    meta: result.meta,
  });
});

const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.sendMessage(req.user as RequestUser, parseConversationId(req), req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Message sent",
    data: result,
  });
});

const sendImages = catchAsync(async (req: Request, res: Response) => {
  const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.images ?? [];

  const result = await ChatService.sendImages(req.user as RequestUser, parseConversationId(req), files, req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: result.length === 1 ? "Photo sent" : `${result.length} photos sent`,
    data: result,
  });
});

const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ChatService.markAsRead(userId, parseConversationId(req));

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Conversation marked as read",
    data: result,
  });
});

const setArchived = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user as RequestUser;

  const result = await ChatService.setArchived(userId, parseConversationId(req), req.body);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.isArchived ? "Conversation archived" : "Conversation moved to inbox",
    data: result,
  });
});

export const ChatController = {
  startConversation,
  getMyConversations,
  getUnreadCount,
  getConversationById,
  getMessages,
  sendMessage,
  sendImages,
  markAsRead,
  setArchived,
};
