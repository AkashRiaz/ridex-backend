import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { MessageType } from "../../../generated/prisma/enums";
import { ConversationWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { queryBuilder } from "../../helper/queryBuilder";
import {
  sellerSummarySelect,
  toSellerSummary,
} from "../../helper/sellerBadges";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { emitToUser, isUserOnline } from "../../lib/socket";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { consumeRateLimit } from "../../utils/redisRateLimit";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import { findBuiltInQuickReply } from "../quickReply/quickReply.utils";
import { UserBlockService } from "../userBlock/userBlock.service";
import {
  IArchiveConversationPayload,
  IMessagesQuery,
  ISendImagesPayload,
  ISendMessagePayload,
  IStartConversationPayload,
} from "./chat.interface";
import {
  CHAT_IMAGE_MIME_TYPES,
  MAX_CHAT_IMAGES,
  SYSTEM_MESSAGE_BATCH_LIMIT,
  TConversationSide,
  buildNewMessageUpdate,
  buildPreview,
  chatRateKeys,
  evaluateReplyState,
  evaluateStartConversation,
  listingNoticeOf,
  normalizeMessageBody,
  otherSide,
  participantIdOf,
  sideFields,
  sideOf,
} from "./chat.utils";

// ============================================
// Shapes
// ============================================

const participantSelect = {
  ...sellerSummarySelect,
  status: true,
  isDeleted: true,
} satisfies Prisma.UserSelect;

const conversationInclude = {
  listing: {
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      status: true,
      isNegotiable: true,
      isDeleted: true,
      sellerId: true,
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  buyer: { select: participantSelect },
  seller: { select: participantSelect },
} satisfies Prisma.ConversationInclude;

type TConversationRow = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

// live state of the offer an OFFER card (or offer notice) points to
export const offerCardSelect = {
  id: true,
  amount: true,
  status: true,
  proposedById: true,
  round: true,
  parentOfferId: true,
  expiresAt: true,
  respondedAt: true,
} satisfies Prisma.OfferSelect;

// live state of the test ride a TEST_RIDE card (or notice) points to
export const testRideCardSelect = {
  id: true,
  status: true,
  startsAt: true,
  endsAt: true,
  sellerNote: true,
  confirmedAt: true,
} satisfies Prisma.TestRideSelect;

export const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  type: true,
  body: true,
  imageUrl: true,
  quickReplyKey: true,
  clientId: true,
  offerId: true,
  offer: { select: offerCardSelect },
  testRideId: true,
  testRide: { select: testRideCardSelect },
  createdAt: true,
} satisfies Prisma.MessageSelect;

type TMessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

// Decimal → number, so cards serialize the same way over REST and Socket.io
const toMessage = (message: TMessageRow) => ({
  ...message,
  offer: message.offer
    ? { ...message.offer, amount: Number(message.offer.amount) }
    : null,
});

export type TChatMessage = ReturnType<typeof toMessage>;

type TParticipantRow = TConversationRow["buyer"];

const toParticipant = (user: TParticipantRow) =>
  user.isDeleted
    ? {
        id: user.id,
        name: "Deleted user",
        imageUrl: null,
        role: user.role,
        ratingAverage: 0,
        ratingCount: 0,
        badges: {
          phoneVerified: false,
          idVerified: false,
          dealerVerified: false,
        },
        isDeleted: true,
        isOnline: false,
      }
    : {
        ...toSellerSummary(user),
        isDeleted: false,
        isOnline: isUserOnline(user.id),
      };

/*
 * The conversation as one participant sees it.
 */
const toConversationSummary = (
  conversation: TConversationRow,
  userId: string,
) => {
  const side = sideOf(conversation, userId) as TConversationSide;
  const mine = sideFields(side);
  const theirs = sideFields(otherSide(side));
  const counterpart =
    side === "buyer" ? conversation.seller : conversation.buyer;

  return {
    id: conversation.id,
    side,
    listing: {
      id: conversation.listing.id,
      title: conversation.listing.title,
      slug: conversation.listing.slug,
      price: Number(conversation.listing.price),
      status: conversation.listing.status,
      isNegotiable: conversation.listing.isNegotiable,
      isDeleted: conversation.listing.isDeleted,
      coverImage: conversation.listing.images[0]?.url ?? null,
    },
    counterpart: toParticipant(counterpart),
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageFromMe: conversation.lastMessageSenderId === userId,
    unreadCount: conversation[mine.unread],
    isArchived: Boolean(conversation[mine.archived]),
    myLastReadAt: conversation[mine.lastRead],
    counterpartLastReadAt: conversation[theirs.lastRead],
    createdAt: conversation.createdAt,
  };
};

// ============================================
// Loading & access
// ============================================

const findConversationForUser = async (
  userId: string,
  conversationId: string,
) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: conversationInclude,
  });

  // same 404 for "missing" and "not yours", so ids cannot be probed
  if (!conversation || !sideOf(conversation, userId)) {
    throw new AppError(httpStatus.NOT_FOUND, "Conversation not found");
  }

  return {
    conversation,
    side: sideOf(conversation, userId) as TConversationSide,
  };
};

const getReplyState = async (
  conversation: TConversationRow,
  side: TConversationSide,
) => {
  const counterpart =
    side === "buyer" ? conversation.seller : conversation.buyer;
  const myId = participantIdOf(conversation, side);

  const block = await UserBlockService.getBlockState(myId, counterpart.id);

  return {
    block,
    result: evaluateReplyState({
      listing: conversation.listing,
      counterpart,
      block,
    }),
  };
};

const assertCanReply = async (
  conversation: TConversationRow,
  side: TConversationSide,
) => {
  const { result } = await getReplyState(conversation, side);

  if (!result.allowed) {
    throw new AppError(httpStatus.FORBIDDEN, result.reason);
  }
};

const assertMessageRate = async (userId: string, cost = 1) => {
  const allowed = await consumeRateLimit(
    chatRateKeys.message(userId),
    config.chat_message_rate_limit,
    60,
    cost,
  );

  if (!allowed) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "You are sending messages too quickly. Please slow down.",
    );
  }
};

// ============================================
// Unread
// ============================================

const getUnreadCount = async (userId: string) => {
  const [asBuyer, asSeller] = await Promise.all([
    prisma.conversation.aggregate({
      where: { buyerId: userId, buyerUnreadCount: { gt: 0 } },
      _sum: { buyerUnreadCount: true },
      _count: { _all: true },
    }),
    prisma.conversation.aggregate({
      where: { sellerId: userId, sellerUnreadCount: { gt: 0 } },
      _sum: { sellerUnreadCount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    total:
      (asBuyer._sum.buyerUnreadCount ?? 0) +
      (asSeller._sum.sellerUnreadCount ?? 0),
    conversations: asBuyer._count._all + asSeller._count._all,
  };
};

const pushUnreadCount = async (userId: string) => {
  emitToUser(userId, "chat:unread", await getUnreadCount(userId));
};

// ============================================
// Sending (shared by REST, socket and images)
// ============================================

type TNewMessage = {
  type: MessageType;
  body: string;
  imageUrl?: string;
  imagePublicId?: string;
  quickReplyKey?: string | null;
  clientId?: string | null;
  offerId?: string | null;
  testRideId?: string | null;
  // conversation list preview; defaults to buildPreview(type, body)
  preview?: string;
};

/*
 * A retried optimistic send (same clientId) returns the stored message.
 */
const findDuplicate = (senderId: string, clientId?: string | null) =>
  clientId
    ? prisma.message.findUnique({
        where: { senderId_clientId: { senderId, clientId } },
        select: messageSelect,
      })
    : Promise.resolve(null);

const persistMessage = async (
  conversation: TConversationRow,
  side: TConversationSide,
  senderId: string,
  input: TNewMessage,
) => {
  const at = new Date();
  const senderHadUnread = conversation[sideFields(side).unread] > 0;

  try {
    const [message, updated] = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId,
          type: input.type,
          body: input.body,
          imageUrl: input.imageUrl ?? null,
          imagePublicId: input.imagePublicId ?? null,
          quickReplyKey: input.quickReplyKey ?? null,
          clientId: input.clientId ?? null,
          offerId: input.offerId ?? null,
          testRideId: input.testRideId ?? null,
          createdAt: at,
        },
        select: messageSelect,
      });

      const conversationAfter = await tx.conversation.update({
        where: { id: conversation.id },
        data: buildNewMessageUpdate({
          senderSide: side,
          senderId,
          preview: input.preview ?? buildPreview(input.type, input.body),
          at,
        }),
        include: conversationInclude,
      });

      return [created, conversationAfter] as const;
    });

    return {
      message: toMessage(message),
      conversation: updated,
      senderHadUnread,
      duplicate: false,
    };
  } catch (error) {
    // two tabs retrying the same optimistic send at once
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      input.clientId
    ) {
      const existing = await findDuplicate(senderId, input.clientId);

      if (existing) {
        return {
          message: toMessage(existing),
          conversation,
          senderHadUnread: false,
          duplicate: true,
        };
      }
    }

    throw error;
  }
};

/*
 * Side effects AFTER commit: both participants get the message with their
 * own view of the conversation; the recipient gets a fresh unread count.
 */
const broadcastMessage = async (
  conversation: TConversationRow,
  message: TChatMessage,
  options: { senderHadUnread?: boolean } = {},
) => {
  for (const userId of [conversation.buyerId, conversation.sellerId]) {
    emitToUser(userId, "message:new", {
      conversation: toConversationSummary(conversation, userId),
      message,
    });
  }

  if (!message.senderId) {
    await Promise.all([
      pushUnreadCount(conversation.buyerId),
      pushUnreadCount(conversation.sellerId),
    ]);
    return;
  }

  const senderSide = sideOf(
    conversation,
    message.senderId,
  ) as TConversationSide;
  const recipientId = participantIdOf(conversation, otherSide(senderSide));

  await pushUnreadCount(recipientId);

  if (options.senderHadUnread) {
    // replying marks the thread read for the sender: their ticks update for the other side
    const readEvent = {
      conversationId: conversation.id,
      readerId: message.senderId,
      readAt: message.createdAt,
    };
    emitToUser(recipientId, "conversation:read", readEvent);
    emitToUser(message.senderId, "conversation:read", readEvent);
    await pushUnreadCount(message.senderId);
  }

  appEvents.emit("message.created", {
    messageId: message.id,
    conversationId: conversation.id,
    senderId: message.senderId,
    recipientId,
  });
};

const resolveTextMessage = (
  side: TConversationSide,
  payload: ISendMessagePayload,
): TNewMessage => {
  const body = normalizeMessageBody(payload.body ?? "");
  const quickReply = payload.quickReplyKey
    ? findBuiltInQuickReply(side, payload.quickReplyKey)
    : null;

  if (payload.quickReplyKey && !quickReply && !body) {
    throw new AppError(httpStatus.BAD_REQUEST, "Unknown quick reply");
  }

  const text = body || quickReply?.text || "";

  if (!text) {
    throw new AppError(httpStatus.BAD_REQUEST, "Message cannot be empty");
  }

  return {
    type: MessageType.TEXT,
    body: text,
    quickReplyKey: quickReply?.key ?? null,
    clientId: payload.clientId ?? null,
  };
};

const sendMessage = async (
  requestUser: RequestUser,
  conversationId: string,
  payload: ISendMessagePayload,
) => {
  const duplicate = await findDuplicate(requestUser.userId, payload.clientId);

  if (duplicate) {
    if (duplicate.conversationId !== conversationId) {
      throw new AppError(
        httpStatus.CONFLICT,
        "This message ID was already used",
      );
    }
    return toMessage(duplicate);
  }

  const { conversation, side } = await findConversationForUser(
    requestUser.userId,
    conversationId,
  );

  await assertCanReply(conversation, side);

  const input = resolveTextMessage(side, payload);

  await assertMessageRate(requestUser.userId);

  const result = await persistMessage(
    conversation,
    side,
    requestUser.userId,
    input,
  );

  if (!result.duplicate) {
    await broadcastMessage(result.conversation, result.message, {
      senderHadUnread: result.senderHadUnread,
    });
  }

  return result.message;
};

/*
 * Each photo becomes its own IMAGE message. Uploads are all-or-nothing.
 */
const sendImages = async (
  requestUser: RequestUser,
  conversationId: string,
  files: Express.Multer.File[],
  payload: ISendImagesPayload,
) => {
  if (!files.length) {
    throw new AppError(httpStatus.BAD_REQUEST, "Attach at least one photo");
  }

  if (files.length > MAX_CHAT_IMAGES) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `You can send up to ${MAX_CHAT_IMAGES} photos at once`,
    );
  }

  if (files.some((file) => !CHAT_IMAGE_MIME_TYPES.includes(file.mimetype))) {
    throw new AppError(
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
      "Only JPG, PNG, WEBP or AVIF photos can be sent",
    );
  }

  const { conversation, side } = await findConversationForUser(
    requestUser.userId,
    conversationId,
  );

  await assertCanReply(conversation, side);
  await assertMessageRate(requestUser.userId, files.length);

  const uploads = await Promise.allSettled(
    files.map((file) =>
      uploadToCloudinary(file, {
        folder: `${config.app_name.toLowerCase()}/chat/${conversation.id}`,
      }),
    ),
  );

  if (uploads.some((upload) => upload.status === "rejected")) {
    await Promise.all(
      uploads.map((upload) =>
        upload.status === "fulfilled"
          ? deleteFromCloudinary(upload.value.public_id)
          : Promise.resolve(),
      ),
    );
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Photo upload failed. Please try again.",
    );
  }

  const messages = [];
  let current = conversation;

  for (const [index, upload] of uploads.entries()) {
    if (upload.status !== "fulfilled") continue;

    const result = await persistMessage(current, side, requestUser.userId, {
      type: MessageType.IMAGE,
      body: "",
      imageUrl: upload.value.secure_url,
      imagePublicId: upload.value.public_id,
      clientId: payload.clientIds?.[index] ?? null,
    });

    if (!result.duplicate) {
      await broadcastMessage(result.conversation, result.message, {
        senderHadUnread: index === 0 && result.senderHadUnread,
      });
      current = result.conversation;
    } else {
      // the stored copy wins; drop the second upload
      await deleteFromCloudinary(upload.value.public_id);
    }

    messages.push(result.message);
  }

  return messages;
};

// ============================================
// Start
// ============================================

const startConversation = async (
  requestUser: RequestUser,
  payload: IStartConversationPayload,
) => {
  const existing = await prisma.conversation.findUnique({
    where: {
      listingId_buyerId: {
        listingId: payload.listingId,
        buyerId: requestUser.userId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    const message = await sendMessage(requestUser, existing.id, payload);
    const { conversation } = await findConversationForUser(
      requestUser.userId,
      existing.id,
    );

    return {
      created: false,
      conversation: toConversationSummary(conversation, requestUser.userId),
      message,
    };
  }

  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      isDeleted: true,
      seller: { select: { status: true, isDeleted: true } },
    },
  });

  const block = listing
    ? await UserBlockService.getBlockState(requestUser.userId, listing.sellerId)
    : { blockedByMe: false, blockedMe: false };

  const rule = evaluateStartConversation({
    userId: requestUser.userId,
    listing,
    seller: listing?.seller ?? null,
    block,
  });

  if (!rule.allowed || !listing) {
    const statusCode = rule.allowed
      ? httpStatus.NOT_FOUND
      : rule.code === "LISTING_NOT_FOUND"
        ? httpStatus.NOT_FOUND
        : rule.code === "OWN_LISTING"
          ? httpStatus.BAD_REQUEST
          : httpStatus.FORBIDDEN;

    throw new AppError(
      statusCode,
      rule.allowed ? "Listing not found" : rule.reason,
    );
  }

  const input = resolveTextMessage("buyer", payload);

  const allowed = await consumeRateLimit(
    chatRateKeys.conversation(requestUser.userId),
    config.chat_new_conversation_limit,
    60 * 60,
  );

  if (!allowed) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "You have started too many conversations. Please try again in an hour.",
    );
  }

  await assertMessageRate(requestUser.userId);

  let conversation: TConversationRow;

  try {
    conversation = await prisma.conversation.create({
      data: {
        listingId: listing.id,
        buyerId: requestUser.userId,
        sellerId: listing.sellerId,
      },
      include: conversationInclude,
    });
  } catch (error) {
    // double-click on "Send": the other request created it first
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return startConversation(requestUser, payload);
    }
    throw error;
  }

  const result = await persistMessage(
    conversation,
    "buyer",
    requestUser.userId,
    input,
  );

  await broadcastMessage(result.conversation, result.message);

  return {
    created: true,
    conversation: toConversationSummary(
      result.conversation,
      requestUser.userId,
    ),
    message: result.message,
  };
};

// ============================================
// Reads
// ============================================

const getMyConversations = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const sides: TConversationSide[] =
    query.side === "buying"
      ? ["buyer"]
      : query.side === "selling"
        ? ["seller"]
        : ["buyer", "seller"];
  const archived = query.archived === "true";
  const unreadOnly = query.unread === "true";
  const term =
    typeof query.searchTerm === "string" ? query.searchTerm.trim() : "";
  const contains = { contains: term, mode: "insensitive" as const };

  const sideConditions: ConversationWhereInput[] = sides.map((side) => {
    const fields = sideFields(side);

    return {
      [side === "buyer" ? "buyerId" : "sellerId"]: userId,
      [fields.archived]: archived ? { not: null } : null,
      ...(unreadOnly && { [fields.unread]: { gt: 0 } }),
      ...(term && {
        OR: [
          { listing: { title: contains } },
          side === "buyer"
            ? { seller: { name: contains } }
            : { buyer: { name: contains } },
        ],
      }),
    };
  });

  const where: ConversationWhereInput = { OR: sideConditions };

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: limit,
      skip,
      include: conversationInclude,
    }),
    prisma.conversation.count({ where }),
  ]);

  return {
    data: conversations.map((conversation) =>
      toConversationSummary(conversation, userId),
    ),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getConversationById = async (userId: string, conversationId: string) => {
  const { conversation, side } = await findConversationForUser(
    userId,
    conversationId,
  );
  const { block, result } = await getReplyState(conversation, side);

  return {
    ...toConversationSummary(conversation, userId),
    block,
    canReply: result.allowed,
    readOnlyCode: result.allowed ? null : result.code,
    readOnlyReason: result.allowed ? null : result.reason,
    listingNotice: listingNoticeOf(conversation.listing.status),
  };
};

const getMessages = async (
  userId: string,
  conversationId: string,
  query: IMessagesQuery,
) => {
  await findConversationForUser(userId, conversationId);

  const limit = query.limit ?? 30;

  let cursorWhere: Prisma.MessageWhereInput = {};

  if (query.before) {
    const cursor = await prisma.message.findFirst({
      where: { id: query.before, conversationId },
      select: { id: true, createdAt: true },
    });

    if (!cursor) {
      throw new AppError(httpStatus.BAD_REQUEST, "Invalid cursor");
    }

    cursorWhere = {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  const rows = await prisma.message.findMany({
    where: { conversationId, ...cursorWhere },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: messageSelect,
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  return {
    // oldest first, ready to render
    data: page.reverse().map(toMessage),
    meta: {
      limit,
      hasMore,
      nextCursor: hasMore ? (page[0]?.id ?? null) : null,
    },
  };
};

// ============================================
// Read receipts & archive
// ============================================

const markAsRead = async (userId: string, conversationId: string) => {
  const { conversation, side } = await findConversationForUser(
    userId,
    conversationId,
  );
  const mine = sideFields(side);
  const lastReadAt = conversation[mine.lastRead];

  const alreadyRead =
    conversation[mine.unread] === 0 &&
    lastReadAt &&
    lastReadAt.getTime() >= conversation.lastMessageAt.getTime();

  if (alreadyRead) {
    return { conversationId, readAt: lastReadAt, unreadCount: 0 };
  }

  const readAt = new Date();

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { [mine.unread]: 0, [mine.lastRead]: readAt },
  });

  const readEvent = { conversationId, readerId: userId, readAt };
  const counterpartId = participantIdOf(conversation, otherSide(side));

  emitToUser(counterpartId, "conversation:read", readEvent);
  // the reader's other tabs clear their badges too
  emitToUser(userId, "conversation:read", readEvent);
  await pushUnreadCount(userId);

  return { conversationId, readAt, unreadCount: 0 };
};

const setArchived = async (
  userId: string,
  conversationId: string,
  payload: IArchiveConversationPayload,
) => {
  const { side } = await findConversationForUser(userId, conversationId);

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: { [sideFields(side).archived]: payload.archived ? new Date() : null },
    include: conversationInclude,
  });

  return toConversationSummary(updated, userId);
};

// ============================================
// Used by other modules
// ============================================

/*
 * listing.sold: a SYSTEM notice in every thread about the listing.
 * Unread counters are not touched (it is information, not a message).
 */
const postListingSystemMessage = async (listingId: string, body: string) => {
  const conversations = await prisma.conversation.findMany({
    where: { listingId },
    orderBy: { lastMessageAt: "desc" },
    take: SYSTEM_MESSAGE_BATCH_LIMIT,
    select: { id: true },
  });

  for (const { id } of conversations) {
    const at = new Date();

    const [created, conversation] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: id,
          senderId: null,
          type: MessageType.SYSTEM,
          body,
          createdAt: at,
        },
        select: messageSelect,
      }),
      prisma.conversation.update({
        where: { id },
        data: {
          lastMessageAt: at,
          lastMessagePreview: buildPreview(MessageType.SYSTEM, body),
          lastMessageSenderId: null,
        },
        include: conversationInclude,
      }),
    ]);

    const message = toMessage(created);

    for (const userId of [conversation.buyerId, conversation.sellerId]) {
      emitToUser(userId, "message:new", {
        conversation: toConversationSummary(conversation, userId),
        message,
      });
    }
  }

  return conversations.length;
};

/*
 * Offers (and later test rides): the buyer's thread for a listing, created
 * on first use with the same rules as startConversation (live listing, not
 * your own, active seller, no block, hourly new-conversation limit).
 * An existing thread must still accept replies.
 */
const findOrCreateConversation = async (
  requestUser: RequestUser,
  listingId: string,
): Promise<{ conversation: TConversationRow; created: boolean }> => {
  const existing = await prisma.conversation.findUnique({
    where: {
      listingId_buyerId: { listingId, buyerId: requestUser.userId },
    },
    include: conversationInclude,
  });

  if (existing) {
    await assertCanReply(existing, "buyer");
    return { conversation: existing, created: false };
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      status: true,
      isDeleted: true,
      seller: { select: { status: true, isDeleted: true } },
    },
  });

  const block = listing
    ? await UserBlockService.getBlockState(requestUser.userId, listing.sellerId)
    : { blockedByMe: false, blockedMe: false };

  const rule = evaluateStartConversation({
    userId: requestUser.userId,
    listing,
    seller: listing?.seller ?? null,
    block,
  });

  if (!rule.allowed || !listing) {
    const statusCode =
      rule.allowed || rule.code === "LISTING_NOT_FOUND"
        ? httpStatus.NOT_FOUND
        : rule.code === "OWN_LISTING"
          ? httpStatus.BAD_REQUEST
          : httpStatus.FORBIDDEN;

    throw new AppError(
      statusCode,
      rule.allowed ? "Listing not found" : rule.reason,
    );
  }

  const allowed = await consumeRateLimit(
    chatRateKeys.conversation(requestUser.userId),
    config.chat_new_conversation_limit,
    60 * 60,
  );

  if (!allowed) {
    throw new AppError(
      httpStatus.TOO_MANY_REQUESTS,
      "You have started too many conversations. Please try again in an hour.",
    );
  }

  try {
    const conversation = await prisma.conversation.create({
      data: {
        listingId: listing.id,
        buyerId: requestUser.userId,
        sellerId: listing.sellerId,
      },
      include: conversationInclude,
    });

    return { conversation, created: true };
  } catch (error) {
    // a parallel request created it first
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return findOrCreateConversation(requestUser, listingId);
    }
    throw error;
  }
};

/*
 * The caller is a participant and may still reply
 * (no block, counterpart active, listing not removed).
 */
const assertCanReplyInConversation = async (
  userId: string,
  conversationId: string,
) => {
  const { conversation, side } = await findConversationForUser(
    userId,
    conversationId,
  );

  await assertCanReply(conversation, side);

  return { conversation, side };
};

// a card or notice points to exactly one offer or one test ride
type TCardRef = { offerId: string } | { testRideId: string };

const cardRefFields = (ref: TCardRef) => ({
  offerId: "offerId" in ref ? ref.offerId : null,
  testRideId: "testRideId" in ref ? ref.testRideId : null,
});

/*
 * An OFFER or TEST_RIDE card sent by a participant. It counts as a normal
 * message (unread count, read receipts, email digest). Called after the
 * offer / test-ride transaction commits.
 */
const postCardMessage = async (
  input: {
    type: typeof MessageType.OFFER | typeof MessageType.TEST_RIDE;
    conversationId: string;
    senderId: string;
    body: string;
    preview: string;
  } & TCardRef,
) => {
  const { conversation, side } = await findConversationForUser(
    input.senderId,
    input.conversationId,
  );

  const result = await persistMessage(conversation, side, input.senderId, {
    type: input.type,
    body: normalizeMessageBody(input.body),
    ...cardRefFields(input),
    preview: input.preview,
  });

  await broadcastMessage(result.conversation, result.message, {
    senderHadUnread: result.senderHadUnread,
  });

  return result.message;
};

/*
 * A SYSTEM notice about an offer or test ride (accepted, cancelled, …).
 * `unreadForUserId` is the side that should notice it (unread +1, archive
 * cleared); null leaves both counters alone.
 */
const postCardNotice = async (
  input: {
    conversationId: string;
    body: string;
    unreadForUserId: string | null;
  } & TCardRef,
) => {
  const at = new Date();

  const [created, conversation] = await prisma.$transaction(async (tx) => {
    const current = await tx.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      select: { buyerId: true, sellerId: true },
    });

    const unreadSide = input.unreadForUserId
      ? sideOf(current, input.unreadForUserId)
      : null;
    const unread = unreadSide ? sideFields(unreadSide) : null;

    const message = await tx.message.create({
      data: {
        conversationId: input.conversationId,
        senderId: null,
        type: MessageType.SYSTEM,
        body: input.body,
        ...cardRefFields(input),
        createdAt: at,
      },
      select: messageSelect,
    });

    const updated = await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        lastMessageAt: at,
        lastMessagePreview: buildPreview(MessageType.SYSTEM, input.body),
        lastMessageSenderId: null,
        ...(unread && {
          [unread.unread]: { increment: 1 },
          [unread.archived]: null,
        }),
      },
      include: conversationInclude,
    });

    return [message, updated] as const;
  });

  const message = toMessage(created);

  for (const userId of [conversation.buyerId, conversation.sellerId]) {
    emitToUser(userId, "message:new", {
      conversation: toConversationSummary(conversation, userId),
      message,
    });
  }

  if (input.unreadForUserId) {
    await pushUnreadCount(input.unreadForUserId);
  }

  return message;
};

/*
 * Typing indicators: participant check only (no DB write).
 * Returns the other participant's id, or null when not allowed.
 */
const getCounterpartId = async (userId: string, conversationId: string) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { buyerId: true, sellerId: true },
  });

  if (!conversation) return null;

  const side = sideOf(conversation, userId);

  return side ? participantIdOf(conversation, otherSide(side)) : null;
};

export const ChatService = {
  startConversation,
  getMyConversations,
  getUnreadCount,
  getConversationById,
  getMessages,
  sendMessage,
  sendImages,
  markAsRead,
  setArchived,
  postListingSystemMessage,
  getCounterpartId,
  findOrCreateConversation,
  assertCanReplyInConversation,
  postCardMessage,
  postCardNotice,
};
