import { ListingStatus, MessageType, Role, UserStatus } from "../../../generated/prisma/enums";
import { IBlockState } from "../userBlock/userBlock.interface";

// ============================================
// Constants
// ============================================

// marketplace roles that can buy and sell; staff see messages only through reports
export const CHAT_ROLES: Role[] = [Role.BUYER, Role.SELLER, Role.DEALER, Role.DEALER_STAFF, Role.INSPECTOR];

export const MAX_MESSAGE_LENGTH = 2000;

export const MAX_CHAT_IMAGES = 4;

export const CHAT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export const MESSAGES_DEFAULT_LIMIT = 30;

export const MESSAGES_MAX_LIMIT = 50;

export const PREVIEW_LENGTH = 120;

// SYSTEM messages are posted into every open thread of a listing, bounded per run
export const SYSTEM_MESSAGE_BATCH_LIMIT = 500;

export const chatRateKeys = {
  message: (userId: string) => `chat-message-rate:${userId}`,
  conversation: (userId: string) => `chat-conversation-rate:${userId}`,
};

// BullMQ custom job ids must not contain ":"
export const unreadEmailJobId = (conversationId: string, userId: string) =>
  `unread-messages-${conversationId}-${userId}`;

export const unreadEmailCooldownKey = (conversationId: string, userId: string) =>
  `chat-email-sent:${conversationId}:${userId}`;

// ============================================
// Sides
// ============================================

export type TConversationSide = "buyer" | "seller";

type TParticipants = { buyerId: string; sellerId: string };

export const sideOf = (conversation: TParticipants, userId: string): TConversationSide | null => {
  if (conversation.buyerId === userId) return "buyer";
  if (conversation.sellerId === userId) return "seller";
  return null;
};

export const otherSide = (side: TConversationSide): TConversationSide => (side === "buyer" ? "seller" : "buyer");

export const participantIdOf = (conversation: TParticipants, side: TConversationSide) =>
  side === "buyer" ? conversation.buyerId : conversation.sellerId;

export const sideFields = (side: TConversationSide) =>
  side === "buyer"
    ? ({
        unread: "buyerUnreadCount",
        lastRead: "buyerLastReadAt",
        archived: "buyerArchivedAt",
      } as const)
    : ({
        unread: "sellerUnreadCount",
        lastRead: "sellerLastReadAt",
        archived: "sellerArchivedAt",
      } as const);

// ============================================
// Rules (pure, unit-tested)
// ============================================

type TRuleResult<TCode extends string> = { allowed: true } | { allowed: false; code: TCode; reason: string };

type TListingState = { sellerId: string; status: ListingStatus; isDeleted: boolean };
type TUserState = { status: UserStatus; isDeleted: boolean };

/*
 * Starting a NEW conversation: the listing must be live, not your own,
 * the seller must be active, and neither side may have blocked the other.
 */
export const evaluateStartConversation = (input: {
  userId: string;
  listing: TListingState | null;
  seller: TUserState | null;
  block: IBlockState;
}): TRuleResult<"LISTING_NOT_FOUND" | "OWN_LISTING" | "LISTING_UNAVAILABLE" | "SELLER_UNAVAILABLE" | "BLOCKED"> => {
  const { listing, seller } = input;

  if (!listing || listing.isDeleted) {
    return { allowed: false, code: "LISTING_NOT_FOUND", reason: "Listing not found" };
  }

  if (listing.sellerId === input.userId) {
    return { allowed: false, code: "OWN_LISTING", reason: "You cannot message yourself about your own listing" };
  }

  if (listing.status !== ListingStatus.APPROVED) {
    return { allowed: false, code: "LISTING_UNAVAILABLE", reason: "This listing is not accepting new messages" };
  }

  if (!seller || seller.isDeleted || seller.status === UserStatus.BLOCKED) {
    return { allowed: false, code: "SELLER_UNAVAILABLE", reason: "This seller is not available right now" };
  }

  if (input.block.blockedByMe) {
    return { allowed: false, code: "BLOCKED", reason: "You blocked this seller. Unblock them to send a message." };
  }

  if (input.block.blockedMe) {
    return { allowed: false, code: "BLOCKED", reason: "You cannot message this seller" };
  }

  return { allowed: true };
};

export type TReplyCode = "BLOCKED_BY_ME" | "BLOCKED_ME" | "COUNTERPART_UNAVAILABLE" | "LISTING_REMOVED";

/*
 * Replying in an EXISTING conversation. Sold, expired and in-review
 * listings keep their threads open; removed listings make them read-only.
 */
export const evaluateReplyState = (input: {
  listing: { status: ListingStatus; isDeleted: boolean };
  counterpart: TUserState;
  block: IBlockState;
}): TRuleResult<TReplyCode> => {
  if (input.block.blockedByMe) {
    return { allowed: false, code: "BLOCKED_BY_ME", reason: "You blocked this user. Unblock them to reply." };
  }

  if (input.block.blockedMe) {
    return { allowed: false, code: "BLOCKED_ME", reason: "You can no longer reply to this conversation" };
  }

  if (input.counterpart.isDeleted || input.counterpart.status === UserStatus.BLOCKED) {
    return { allowed: false, code: "COUNTERPART_UNAVAILABLE", reason: "This account is no longer active" };
  }

  if (input.listing.isDeleted || input.listing.status === ListingStatus.REJECTED) {
    return {
      allowed: false,
      code: "LISTING_REMOVED",
      reason: "This listing was removed, so the conversation is read-only",
    };
  }

  return { allowed: true };
};

// banner shown above an open thread
export const listingNoticeOf = (status: ListingStatus) => {
  if (status === ListingStatus.SOLD) return "This listing has been sold";
  if (status === ListingStatus.EXPIRED) return "This listing has expired";
  if (status === ListingStatus.PENDING) return "This listing is being reviewed after an edit";
  return null;
};

// ============================================
// Messages
// ============================================

/*
 * Plain text only: strips control characters (keeps newlines and tabs),
 * trims, and collapses long runs of blank lines.
 */
export const normalizeMessageBody = (body: string) =>
  body
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters on purpose
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

export const buildPreview = (type: MessageType, body: string) => {
  if (type === MessageType.IMAGE) return "📷 Photo";

  const singleLine = body.replace(/\s+/g, " ").trim();

  return singleLine.length > PREVIEW_LENGTH ? `${singleLine.slice(0, PREVIEW_LENGTH - 1)}…` : singleLine;
};

/*
 * Conversation update for a new message, applied in the same transaction:
 * the recipient's unread count goes up and their archive is cleared;
 * the sender has, by definition, read everything up to now.
 */
export const buildNewMessageUpdate = (input: {
  senderSide: TConversationSide;
  senderId: string;
  preview: string;
  at: Date;
}) => {
  const sender = sideFields(input.senderSide);
  const recipient = sideFields(otherSide(input.senderSide));

  return {
    lastMessageAt: input.at,
    lastMessagePreview: input.preview,
    lastMessageSenderId: input.senderId,
    [recipient.unread]: { increment: 1 },
    [recipient.archived]: null,
    [sender.unread]: 0,
    [sender.lastRead]: input.at,
  };
};

// a message is "seen" once the other side's read marker has passed it
export const isSeenBy = (messageCreatedAt: Date, lastReadAt: Date | null) =>
  Boolean(lastReadAt && lastReadAt.getTime() >= messageCreatedAt.getTime());
