import { Job } from "bullmq";
import {
  MessageType,
  NotificationCategory,
  UserStatus,
} from "../../generated/prisma/enums";
import { dashboardLink } from "../helper/dashboardPath";
import { prisma } from "../lib/prisma";
import { QUEUE_NAMES, startWorker } from "../lib/queue";
import { redisClient } from "../lib/redis";
import { isUserOnline } from "../lib/socket";
import {
  otherSide,
  participantIdOf,
  sideFields,
  sideOf,
  unreadEmailCooldownKey,
} from "../module/chat/chat.utils";
import {
  INotificationEmailJob,
  IUnreadMessagesEmailJob,
} from "../module/notification/notification.interface";
import { NotificationService } from "../module/notification/notification.service";
import {
  DIGEST_COOLDOWN_SECONDS,
  buildUnsubscribeUrl,
  getDigestSkipReason,
  isChannelEnabled,
  toAbsoluteLink,
} from "../module/notification/notification.utils";
import { offerPreview } from "../module/offer/offer.utils";
import { testRidePreview } from "../module/testRide/testRide.utils";
import { sendEmail } from "../utils/sendEmail";

/*
 * notification-email queue:
 *   "notification"     one in-app notification mirrored to email
 *   "unread-messages"  delayed chat digest (one per conversation + recipient)
 * Preferences are re-read when the job runs, so a user who switched
 * email off in the meantime gets nothing.
 */

const DIGEST_MESSAGE_LIMIT = 5;

const loadRecipient = (userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      email: true,
      emailVerified: true,
      isDeleted: true,
      status: true,
    },
  });

const processNotificationEmail = async (data: INotificationEmailJob) => {
  const user = await loadRecipient(data.userId);

  if (
    !user ||
    user.isDeleted ||
    user.status === UserStatus.BLOCKED ||
    !user.email ||
    !user.emailVerified
  ) {
    return "skipped: recipient";
  }

  const rows = await NotificationService.getPreferenceRows(
    [user.id],
    data.category,
  );

  if (!isChannelEnabled(rows, data.category, "email")) {
    return "skipped: email off";
  }

  await sendEmail({
    to: user.email,
    subject: data.subject,
    template: "notification",
    data: {
      name: user.name,
      title: data.title,
      body: data.body,
      ctaUrl: toAbsoluteLink(data.link),
      ctaLabel: data.ctaLabel,
      unsubscribeUrl: buildUnsubscribeUrl(user.id, data.category),
    },
  });

  return "sent";
};

const processUnreadMessagesEmail = async (data: IUnreadMessagesEmailJob) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: data.conversationId },
    include: {
      listing: { select: { title: true } },
      buyer: { select: { name: true } },
      seller: { select: { name: true } },
    },
  });

  const side = conversation ? sideOf(conversation, data.userId) : null;

  if (!conversation || !side) return "skipped: conversation";

  const user = await loadRecipient(data.userId);
  if (!user) return "skipped: recipient";

  const mine = sideFields(side);
  const unreadCount = conversation[mine.unread];

  const [rows, onCooldown] = await Promise.all([
    NotificationService.getPreferenceRows(
      [user.id],
      NotificationCategory.MESSAGES,
    ),
    redisClient
      .exists(unreadEmailCooldownKey(conversation.id, user.id))
      .then((count) => count > 0)
      .catch(() => false),
  ]);

  const skipReason = getDigestSkipReason({
    unreadCount,
    isOnline: isUserOnline(user.id),
    isActive: !user.isDeleted && user.status !== UserStatus.BLOCKED,
    hasVerifiedEmail: Boolean(user.email && user.emailVerified),
    emailEnabled: isChannelEnabled(
      rows,
      NotificationCategory.MESSAGES,
      "email",
    ),
    onCooldown,
  });

  if (skipReason || !user.email) return `skipped: ${skipReason}`;

  const senderId = participantIdOf(conversation, otherSide(side));
  const senderName =
    side === "buyer" ? conversation.seller.name : conversation.buyer.name;

  const messages = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      senderId,
      ...(conversation[mine.lastRead] && {
        createdAt: { gt: conversation[mine.lastRead] as Date },
      }),
    },
    orderBy: { createdAt: "desc" },
    take: DIGEST_MESSAGE_LIMIT,
    select: {
      type: true,
      body: true,
      createdAt: true,
      offer: { select: { amount: true } },
      testRide: { select: { startsAt: true } },
    },
  });

  await sendEmail({
    to: user.email,
    subject:
      unreadCount === 1
        ? `New message from ${senderName}`
        : `${unreadCount} new messages from ${senderName}`,
    template: "unread-messages",
    data: {
      name: user.name,
      senderName,
      listingTitle: conversation.listing.title,
      unreadCount,
      messages: messages.reverse().map((message) => ({
        text:
          message.type === MessageType.IMAGE
            ? "📷 Photo"
            : message.type === MessageType.OFFER && message.offer
              ? offerPreview(Number(message.offer.amount), message.body)
              : message.type === MessageType.TEST_RIDE && message.testRide
                ? testRidePreview(message.testRide.startsAt)
                : message.body,
      })),
      ctaUrl: toAbsoluteLink(
        dashboardLink(user.role, `/messages/${conversation.id}`),
      ),
      unsubscribeUrl: buildUnsubscribeUrl(
        user.id,
        NotificationCategory.MESSAGES,
      ),
    },
  });

  await redisClient
    .setEx(
      unreadEmailCooldownKey(conversation.id, user.id),
      DIGEST_COOLDOWN_SECONDS,
      "1",
    )
    .catch((error) => console.error("Failed to set digest cooldown:", error));

  return "sent";
};

export const processNotificationEmailJob = async (job: Job) => {
  if (job.name === "notification") {
    return processNotificationEmail(job.data as INotificationEmailJob);
  }

  if (job.name === "unread-messages") {
    return processUnreadMessagesEmail(job.data as IUnreadMessagesEmailJob);
  }

  return `skipped: unknown job ${job.name}`;
};

export const startNotificationEmailWorker = () =>
  startWorker(QUEUE_NAMES.notificationEmail, processNotificationEmailJob, 5);
