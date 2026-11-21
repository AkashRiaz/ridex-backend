import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
  NotificationCategory,
  UserStatus,
} from "../../../generated/prisma/enums";
import { NotificationWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES, enqueueJob } from "../../lib/queue";
import { emitToUser } from "../../lib/socket";
import { AppError } from "../../utils/AppError";
import { unreadEmailJobId } from "../chat/chat.utils";
import {
  INotificationEmailJob,
  INotifyPayload,
  IUnreadMessagesEmailJob,
  IUnsubscribePayload,
  IUpdatePreferencesPayload,
} from "./notification.interface";
import {
  NOTIFICATION_CATEGORIES,
  TYPE_CATEGORY,
  findLockedChange,
  isChannelEnabled,
  resolvePreferences,
  verifyUnsubscribeToken,
} from "./notification.utils";

const notificationSelect = {
  id: true,
  type: true,
  category: true,
  title: true,
  body: true,
  link: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

// ============================================
// Preferences
// ============================================

const getPreferenceRows = (
  userIds: string[],
  category?: NotificationCategory,
) =>
  prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, ...(category && { category }) },
    select: { userId: true, category: true, inApp: true, email: true },
  });

const getMyPreferences = async (userId: string) =>
  resolvePreferences(await getPreferenceRows([userId]));

const updateMyPreferences = async (
  userId: string,
  payload: IUpdatePreferencesPayload,
) => {
  const locked = findLockedChange(payload.preferences);

  if (locked) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${locked.category.toLowerCase().replace("_", " ")} notifications cannot be turned off`,
    );
  }

  const current = await getMyPreferences(userId);

  await prisma.$transaction(
    payload.preferences.map((change) => {
      const resolved = current.find(
        (preference) => preference.category === change.category,
      );
      const values = {
        inApp: change.inApp ?? resolved?.inApp ?? true,
        email: change.email ?? resolved?.email ?? true,
      };

      return prisma.notificationPreference.upsert({
        where: { userId_category: { userId, category: change.category } },
        create: { userId, category: change.category, ...values },
        update: values,
      });
    }),
  );

  return getMyPreferences(userId);
};

const unsubscribe = async (payload: IUnsubscribePayload) => {
  const claims = verifyUnsubscribeToken(payload.token);

  if (!claims) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This unsubscribe link is invalid or has expired",
    );
  }

  const user = await prisma.user.findFirst({
    where: { id: claims.userId, isDeleted: false },
    select: { id: true },
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "Account not found");
  }

  if (findLockedChange([{ category: claims.category, email: false }])) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "These emails cannot be turned off",
    );
  }

  await prisma.notificationPreference.upsert({
    where: { userId_category: { userId: user.id, category: claims.category } },
    create: {
      userId: user.id,
      category: claims.category,
      inApp: true,
      email: false,
    },
    update: { email: false },
  });

  return { category: claims.category, email: false };
};

// ============================================
// Delivery
// ============================================

const pushUnreadCount = async (userId: string) => {
  const unread = await prisma.notification.count({
    where: { userId, readAt: null },
  });
  emitToUser(userId, "notification:unread", { total: unread });
};

/*
 * Fan-out to one or many users: preferences per user, one row each
 * (in-app), a socket push, and an email job (email channel, verified
 * address only). Never throws into the caller — handlers run after commit.
 */
const notifyUsers = async (userIds: string[], payload: INotifyPayload) => {
  const uniqueIds = [...new Set(userIds)];
  if (!uniqueIds.length) return 0;

  const category = TYPE_CATEGORY[payload.type];

  const [users, preferenceRows] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: uniqueIds },
        isDeleted: false,
        status: { not: UserStatus.BLOCKED },
      },
      select: { id: true, role: true, email: true, emailVerified: true },
    }),
    getPreferenceRows(uniqueIds, category),
  ]);

  const deliveries = users.map((user) => {
    const rows = preferenceRows.filter((row) => row.userId === user.id);
    const link =
      typeof payload.link === "function"
        ? payload.link(user.role)
        : (payload.link ?? null);

    return {
      user,
      link,
      inApp: isChannelEnabled(rows, category, "inApp"),
      email:
        Boolean(user.email && user.emailVerified) &&
        isChannelEnabled(rows, category, "email"),
    };
  });

  const inAppDeliveries = deliveries.filter((delivery) => delivery.inApp);

  const created = inAppDeliveries.length
    ? await prisma.notification.createManyAndReturn({
        data: inAppDeliveries.map((delivery) => ({
          userId: delivery.user.id,
          type: payload.type,
          category,
          title: payload.title,
          body: payload.body ?? "",
          link: delivery.link,
          data: payload.data
            ? (payload.data as Prisma.InputJsonValue)
            : undefined,
        })),
        select: { ...notificationSelect, userId: true },
      })
    : [];

  for (const { userId, ...notification } of created) {
    emitToUser(userId, "notification:new", notification);
    await pushUnreadCount(userId);
  }

  for (const delivery of deliveries.filter((item) => item.email)) {
    await enqueueJob<INotificationEmailJob>(
      QUEUE_NAMES.notificationEmail,
      "notification",
      {
        userId: delivery.user.id,
        category,
        subject: payload.title,
        title: payload.title,
        body: payload.body ?? "",
        link: delivery.link,
        ctaLabel: payload.ctaLabel ?? "Open",
      },
    );
  }

  return deliveries.length;
};

const notify = (userId: string, payload: INotifyPayload) =>
  notifyUsers([userId], payload);

/*
 * One delayed job per conversation + recipient (custom job id): while it
 * waits, later messages do not add more. The job re-checks everything
 * when it runs (still unread, user offline, email preference).
 */
const scheduleUnreadMessagesEmail = (conversationId: string, userId: string) =>
  enqueueJob<IUnreadMessagesEmailJob>(
    QUEUE_NAMES.notificationEmail,
    "unread-messages",
    { conversationId, userId },
    {
      ...DEFAULT_JOB_OPTIONS,
      jobId: unreadEmailJobId(conversationId, userId),
      delay: config.chat_email_delay_minutes * 60 * 1000,
      // finished jobs must not keep the id, or the next digest would be skipped
      removeOnComplete: true,
      removeOnFail: true,
    },
  );

// ============================================
// Inbox
// ============================================

const getMyNotifications = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const andConditions: NotificationWhereInput[] = [{ userId }];

  if (query.status === "unread") andConditions.push({ readAt: null });

  if (query.category && NOTIFICATION_CATEGORIES.includes(query.category)) {
    andConditions.push({ category: query.category });
  }

  const where = { AND: andConditions };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: notificationSelect,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    data: notifications,
    meta: { ...queryBuilder.buildMeta(page, limit, total), unreadCount },
  };
};

const getUnreadCount = async (userId: string) => ({
  total: await prisma.notification.count({ where: { userId, readAt: null } }),
});

const markAsRead = async (userId: string, id: string) => {
  const notification = await prisma.notification.findUnique({
    where: { id },
    select: { userId: true, readAt: true },
  });

  if (!notification || notification.userId !== userId) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  const updated = notification.readAt
    ? await prisma.notification.findUniqueOrThrow({
        where: { id },
        select: notificationSelect,
      })
    : await prisma.notification.update({
        where: { id },
        data: { readAt: new Date() },
        select: notificationSelect,
      });

  await pushUnreadCount(userId);

  return updated;
};

const markAllAsRead = async (userId: string) => {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  await pushUnreadCount(userId);

  return { updated: result.count };
};

const deleteNotification = async (userId: string, id: string) => {
  const result = await prisma.notification.deleteMany({
    where: { id, userId },
  });

  if (result.count === 0) {
    throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
  }

  await pushUnreadCount(userId);

  return { id };
};

// cron: read notifications past the retention window
const deleteOldNotifications = async () => {
  const cutoff = new Date(
    Date.now() - config.notification_retention_days * 24 * 60 * 60 * 1000,
  );

  const result = await prisma.notification.deleteMany({
    where: { readAt: { not: null }, createdAt: { lt: cutoff } },
  });

  return result.count;
};

export const NotificationService = {
  notify,
  notifyUsers,
  scheduleUnreadMessagesEmail,
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getMyPreferences,
  updateMyPreferences,
  unsubscribe,
  getPreferenceRows,
  deleteOldNotifications,
};
