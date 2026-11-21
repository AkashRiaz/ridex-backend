import { createServer } from "http";
import { AddressInfo } from "net";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as connectClient } from "socket.io-client";
import app from "../src/app";
import { closeSocket, initSocket } from "../src/app/lib/socket";
import { ListingStatus, MessageType, Role, UserStatus } from "../src/generated/prisma/enums";
import {
  CHAT_ROLES,
  buildNewMessageUpdate,
  buildPreview,
  evaluateReplyState,
  evaluateStartConversation,
  isSeenBy,
  listingNoticeOf,
  normalizeMessageBody,
  sideOf,
  unreadEmailJobId,
} from "../src/app/module/chat/chat.utils";
import {
  MessagesQueryZodSchema,
  SendMessageZodSchema,
  StartConversationZodSchema,
} from "../src/app/module/chat/chat.validation";
import { BUILT_IN_QUICK_REPLIES, findBuiltInQuickReply } from "../src/app/module/quickReply/quickReply.utils";
import { CreateQuickReplyZodSchema } from "../src/app/module/quickReply/quickReply.validation";

const noBlock = { blockedByMe: false, blockedMe: false };
const activeUser = { status: UserStatus.ACTIVE, isDeleted: false };
const liveListing = { sellerId: "seller", status: ListingStatus.APPROVED, isDeleted: false };

// ============================================
// Starting a conversation
// ============================================

describe("starting a conversation", () => {
  const base = { userId: "buyer", listing: liveListing, seller: activeUser, block: noBlock };

  it("allows a buyer to message the seller of a live listing", () => {
    expect(evaluateStartConversation(base)).toEqual({ allowed: true });
  });

  it.each([
    ["missing listing", { listing: null }, "LISTING_NOT_FOUND"],
    ["deleted listing", { listing: { ...liveListing, isDeleted: true } }, "LISTING_NOT_FOUND"],
    ["own listing", { userId: "seller" }, "OWN_LISTING"],
    ["pending listing", { listing: { ...liveListing, status: ListingStatus.PENDING } }, "LISTING_UNAVAILABLE"],
    ["sold listing", { listing: { ...liveListing, status: ListingStatus.SOLD } }, "LISTING_UNAVAILABLE"],
    ["blocked seller account", { seller: { ...activeUser, status: UserStatus.BLOCKED } }, "SELLER_UNAVAILABLE"],
    ["deleted seller account", { seller: { ...activeUser, isDeleted: true } }, "SELLER_UNAVAILABLE"],
    ["buyer blocked the seller", { block: { blockedByMe: true, blockedMe: false } }, "BLOCKED"],
    ["seller blocked the buyer", { block: { blockedByMe: false, blockedMe: true } }, "BLOCKED"],
  ])("rejects %s", (_label, override, code) => {
    const result = evaluateStartConversation({ ...base, ...override });

    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ code });
  });

  it("limits chat to marketplace roles", () => {
    expect(CHAT_ROLES).toEqual(
      expect.arrayContaining([Role.BUYER, Role.SELLER, Role.DEALER, Role.DEALER_STAFF, Role.INSPECTOR]),
    );
    expect(CHAT_ROLES).not.toContain(Role.ADMIN);
    expect(CHAT_ROLES).not.toContain(Role.MODERATOR);
    expect(CHAT_ROLES).not.toContain(Role.SUPER_ADMIN);
  });
});

// ============================================
// Replying in an existing conversation
// ============================================

describe("reply state", () => {
  const base = { listing: liveListing, counterpart: activeUser, block: noBlock };

  it.each([ListingStatus.APPROVED, ListingStatus.SOLD, ListingStatus.EXPIRED, ListingStatus.PENDING])(
    "keeps the thread open when the listing is %s",
    (status) => {
      expect(evaluateReplyState({ ...base, listing: { ...liveListing, status } })).toEqual({ allowed: true });
    },
  );

  it.each([
    ["I blocked them", { block: { blockedByMe: true, blockedMe: false } }, "BLOCKED_BY_ME"],
    ["they blocked me", { block: { blockedByMe: false, blockedMe: true } }, "BLOCKED_ME"],
    ["the other account was deleted", { counterpart: { ...activeUser, isDeleted: true } }, "COUNTERPART_UNAVAILABLE"],
    ["the other account was blocked by staff", { counterpart: { ...activeUser, status: UserStatus.BLOCKED } }, "COUNTERPART_UNAVAILABLE"],
    ["the listing was taken down", { listing: { ...liveListing, status: ListingStatus.REJECTED } }, "LISTING_REMOVED"],
    ["the listing was deleted", { listing: { ...liveListing, isDeleted: true } }, "LISTING_REMOVED"],
  ])("is read-only when %s", (_label, override, code) => {
    expect(evaluateReplyState({ ...base, ...override })).toMatchObject({ allowed: false, code });
  });

  it("checks my own block before theirs", () => {
    expect(evaluateReplyState({ ...base, block: { blockedByMe: true, blockedMe: true } })).toMatchObject({
      code: "BLOCKED_BY_ME",
    });
  });

  it("shows a banner for sold, expired and in-review listings only", () => {
    expect(listingNoticeOf(ListingStatus.SOLD)).toMatch(/sold/);
    expect(listingNoticeOf(ListingStatus.EXPIRED)).toMatch(/expired/);
    expect(listingNoticeOf(ListingStatus.PENDING)).toMatch(/review/);
    expect(listingNoticeOf(ListingStatus.APPROVED)).toBeNull();
  });
});

// ============================================
// Unread counters & read receipts
// ============================================

describe("unread counters", () => {
  const at = new Date("2026-11-21T10:00:00Z");

  it("a buyer message raises the seller's count and clears the buyer's", () => {
    expect(buildNewMessageUpdate({ senderSide: "buyer", senderId: "buyer", preview: "Hi", at })).toEqual({
      lastMessageAt: at,
      lastMessagePreview: "Hi",
      lastMessageSenderId: "buyer",
      sellerUnreadCount: { increment: 1 },
      sellerArchivedAt: null,
      buyerUnreadCount: 0,
      buyerLastReadAt: at,
    });
  });

  it("a seller message raises the buyer's count and un-archives their thread", () => {
    const update = buildNewMessageUpdate({ senderSide: "seller", senderId: "seller", preview: "Yes", at });

    expect(update).toMatchObject({
      buyerUnreadCount: { increment: 1 },
      buyerArchivedAt: null,
      sellerUnreadCount: 0,
      sellerLastReadAt: at,
    });
    expect(update).not.toHaveProperty("sellerArchivedAt");
  });

  it("a message is seen once the reader's marker passes it", () => {
    expect(isSeenBy(at, null)).toBe(false);
    expect(isSeenBy(at, new Date(at.getTime() - 1))).toBe(false);
    expect(isSeenBy(at, at)).toBe(true);
    expect(isSeenBy(at, new Date(at.getTime() + 1000))).toBe(true);
  });

  it("knows which side a user is on", () => {
    const conversation = { buyerId: "b", sellerId: "s" };

    expect(sideOf(conversation, "b")).toBe("buyer");
    expect(sideOf(conversation, "s")).toBe("seller");
    expect(sideOf(conversation, "x")).toBeNull();
  });

  it("builds BullMQ-safe job ids (no colons)", () => {
    expect(unreadEmailJobId("c1", "u1")).not.toContain(":");
  });
});

// ============================================
// Message content
// ============================================

describe("message content", () => {
  it("strips control characters and collapses blank lines", () => {
    expect(normalizeMessageBody("  hi\u0000 there\r\n\r\n\r\n\r\n\r\nbye  ")).toBe("hi there\n\n\nbye");
    expect(normalizeMessageBody("line\tone\nline two")).toBe("line\tone\nline two");
  });

  it("builds a one-line preview", () => {
    expect(buildPreview(MessageType.TEXT, "Hello\n\nthere")).toBe("Hello there");
    expect(buildPreview(MessageType.IMAGE, "")).toBe("📷 Photo");
    expect(buildPreview(MessageType.TEXT, "x".repeat(300))).toHaveLength(120);
  });

  it("requires text or a quick reply", () => {
    expect(SendMessageZodSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(SendMessageZodSchema.safeParse({}).success).toBe(false);
    expect(SendMessageZodSchema.safeParse({ quickReplyKey: "IS_AVAILABLE" }).success).toBe(true);
    expect(SendMessageZodSchema.safeParse({ body: "x".repeat(2001) }).success).toBe(false);
  });

  it("validates the start payload and client ids", () => {
    const listingId = crypto.randomUUID();

    expect(StartConversationZodSchema.safeParse({ listingId, body: "Hi" }).success).toBe(true);
    expect(StartConversationZodSchema.safeParse({ listingId }).success).toBe(false);
    expect(StartConversationZodSchema.safeParse({ listingId: "nope", body: "Hi" }).success).toBe(false);
    expect(StartConversationZodSchema.safeParse({ listingId, body: "Hi", clientId: "123" }).success).toBe(false);
  });

  it("defaults and caps the message page size", () => {
    expect(MessagesQueryZodSchema.parse({}).limit).toBe(30);
    expect(MessagesQueryZodSchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(MessagesQueryZodSchema.safeParse({ before: "not-a-uuid" }).success).toBe(false);
  });
});

// ============================================
// Quick replies
// ============================================

describe("quick replies", () => {
  it("resolves built-in replies per side only", () => {
    expect(findBuiltInQuickReply("buyer", "IS_AVAILABLE")?.text).toMatch(/still available/);
    expect(findBuiltInQuickReply("seller", "IS_AVAILABLE")).toBeNull();
    expect(findBuiltInQuickReply("seller", "YES_AVAILABLE")).not.toBeNull();
  });

  it("uses unique keys that pass message validation", () => {
    const keys = [...BUILT_IN_QUICK_REPLIES.buyer, ...BUILT_IN_QUICK_REPLIES.seller].map((reply) => reply.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(SendMessageZodSchema.safeParse({ quickReplyKey: key }).success).toBe(true);
    }
  });

  it("validates custom replies", () => {
    expect(CreateQuickReplyZodSchema.safeParse({ text: "  " }).success).toBe(false);
    expect(CreateQuickReplyZodSchema.safeParse({ text: "x".repeat(301) }).success).toBe(false);
    expect(CreateQuickReplyZodSchema.safeParse({ text: "I can deliver it" }).success).toBe(true);
  });
});

// ============================================
// Socket token isolation
// ============================================

describe("socket token", () => {
  const socketToken = jwt.sign(
    { userId: "u1", role: Role.BUYER, pwdAt: null, typ: "socket" },
    process.env.JWT_SOCKET_SECRET as string,
    { expiresIn: "5m" },
  );
  const accessToken = jwt.sign(
    { userId: "u1", role: Role.BUYER, pwdAt: null },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: "5m" },
  );

  it("is never accepted by REST auth()", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${socketToken}`);

    expect(res.status).toBe(401);
  });

  it("requires a signed-in user to issue one", async () => {
    const res = await request(app).post("/api/v1/auth/socket-token");

    expect(res.status).toBe(401);
  });

  describe("handshake", () => {
    const server = createServer();
    let url = "";

    beforeAll(async () => {
      initSocket(server, []);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      url = `http://localhost:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await closeSocket();
      server.close();
    });

    const connectWith = (token?: string) =>
      new Promise<string>((resolve) => {
        const client = connectClient(url, {
          auth: token ? { token } : {},
          transports: ["websocket"],
          reconnection: false,
        });

        client.on("connect", () => {
          client.close();
          resolve("connected");
        });
        client.on("connect_error", (error) => {
          client.close();
          resolve(error.message);
        });
      });

    it("rejects a missing token", async () => {
      expect(await connectWith()).toBe("Socket token missing");
    });

    it("rejects a REST access token", async () => {
      expect(await connectWith(accessToken)).toBe("Invalid or expired socket token");
    });

    it("rejects a socket-secret token without the socket type", async () => {
      const untyped = jwt.sign({ userId: "u1", role: Role.BUYER }, process.env.JWT_SOCKET_SECRET as string);

      expect(await connectWith(untyped)).toBe("Invalid socket token");
    });
  });
});
