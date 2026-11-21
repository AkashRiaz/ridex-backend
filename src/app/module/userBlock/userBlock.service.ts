import httpStatus from "http-status";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { emitToUser } from "../../lib/socket";
import { AppError } from "../../utils/AppError";
import { IBlockState } from "./userBlock.interface";

/*
 * Both directions between two users, in one query.
 */
const getBlockState = async (
  userId: string,
  otherUserId: string,
): Promise<IBlockState> => {
  const blocks = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: otherUserId },
        { blockerId: otherUserId, blockedId: userId },
      ],
    },
    select: { blockerId: true },
  });

  return {
    blockedByMe: blocks.some((block) => block.blockerId === userId),
    blockedMe: blocks.some((block) => block.blockerId === otherUserId),
  };
};

const notifyBlockChange = (
  blockerId: string,
  blockedId: string,
  blocked: boolean,
) => {
  emitToUser(blockerId, "block:changed", {
    userId: blockedId,
    blockedByMe: blocked,
  });
  emitToUser(blockedId, "block:changed", {
    userId: blockerId,
    blockedMe: blocked,
  });
};

const blockUser = async (userId: string, targetUserId: string) => {
  if (userId === targetUserId) {
    throw new AppError(httpStatus.BAD_REQUEST, "You cannot block yourself");
  }

  const target = await prisma.user.findFirst({
    where: { id: targetUserId, isDeleted: false },
    select: { id: true, name: true },
  });

  if (!target) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  // idempotent: blocking twice keeps the first block
  const block = await prisma.userBlock.upsert({
    where: {
      blockerId_blockedId: { blockerId: userId, blockedId: targetUserId },
    },
    create: { blockerId: userId, blockedId: targetUserId },
    update: {},
  });

  notifyBlockChange(userId, targetUserId, true);

  return { ...block, blockedUser: target };
};

const unblockUser = async (userId: string, targetUserId: string) => {
  const result = await prisma.userBlock.deleteMany({
    where: { blockerId: userId, blockedId: targetUserId },
  });

  if (result.count === 0) {
    throw new AppError(httpStatus.NOT_FOUND, "This user is not blocked");
  }

  notifyBlockChange(userId, targetUserId, false);

  return { userId: targetUserId, blocked: false };
};

const getMyBlockedUsers = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const where = { blockerId: userId };

  const [blocks, total] = await Promise.all([
    prisma.userBlock.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        createdAt: true,
        blocked: {
          select: {
            id: true,
            name: true,
            imageUrl: true,
            role: true,
            isDeleted: true,
          },
        },
      },
    }),
    prisma.userBlock.count({ where }),
  ]);

  return {
    data: blocks.map((block) => ({
      id: block.id,
      createdAt: block.createdAt,
      user: block.blocked,
    })),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

export const UserBlockService = {
  getBlockState,
  blockUser,
  unblockUser,
  getMyBlockedUsers,
};
