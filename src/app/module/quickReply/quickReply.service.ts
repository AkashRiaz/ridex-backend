import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { ICreateQuickReplyPayload, IUpdateQuickReplyPayload } from "./quickReply.interface";
import { BUILT_IN_QUICK_REPLIES, MAX_CUSTOM_QUICK_REPLIES } from "./quickReply.utils";

const quickReplySelect = { id: true, text: true, sortOrder: true } as const;

const getQuickReplies = async (userId: string) => {
  const custom = await prisma.quickReply.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: quickReplySelect,
  });

  return { builtIn: BUILT_IN_QUICK_REPLIES, custom };
};

const createQuickReply = async (userId: string, payload: ICreateQuickReplyPayload) => {
  const existing = await prisma.quickReply.findMany({
    where: { userId },
    select: { text: true, sortOrder: true },
  });

  if (existing.length >= MAX_CUSTOM_QUICK_REPLIES) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You can save up to ${MAX_CUSTOM_QUICK_REPLIES} quick replies. Delete one to add another.`,
    );
  }

  if (existing.some((reply) => reply.text.toLowerCase() === payload.text.toLowerCase())) {
    throw new AppError(httpStatus.CONFLICT, "You already saved this reply");
  }

  return prisma.quickReply.create({
    data: {
      userId,
      text: payload.text,
      sortOrder: existing.reduce((max, reply) => Math.max(max, reply.sortOrder + 1), 0),
    },
    select: quickReplySelect,
  });
};

const findOwnQuickReply = async (userId: string, id: string) => {
  const reply = await prisma.quickReply.findUnique({ where: { id } });

  if (!reply || reply.userId !== userId) {
    throw new AppError(httpStatus.NOT_FOUND, "Quick reply not found");
  }

  return reply;
};

const updateQuickReply = async (userId: string, id: string, payload: IUpdateQuickReplyPayload) => {
  await findOwnQuickReply(userId, id);

  return prisma.quickReply.update({
    where: { id },
    data: payload,
    select: quickReplySelect,
  });
};

const deleteQuickReply = async (userId: string, id: string) => {
  await findOwnQuickReply(userId, id);

  await prisma.quickReply.delete({ where: { id } });

  return { id };
};

export const QuickReplyService = {
  getQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
};
