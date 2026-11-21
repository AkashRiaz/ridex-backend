import { z } from "zod";
import {
  MAX_CHAT_IMAGES,
  MAX_MESSAGE_LENGTH,
  MESSAGES_DEFAULT_LIMIT,
  MESSAGES_MAX_LIMIT,
} from "./chat.utils";

const messageBody = z
  .string()
  .trim()
  .max(
    MAX_MESSAGE_LENGTH,
    `A message can be at most ${MAX_MESSAGE_LENGTH} characters`,
  )
  .optional();

const quickReplyKey = z
  .string()
  .trim()
  .regex(/^[A-Z_]{2,40}$/, "Invalid quick reply")
  .optional();

// client-generated id for optimistic UI (uuid v4 from crypto.randomUUID())
const clientId = z.uuid("Invalid client message ID").optional();

const hasContent = (data: { body?: string; quickReplyKey?: string }) =>
  Boolean(data.body?.trim()) || Boolean(data.quickReplyKey);

export const StartConversationZodSchema = z
  .object({
    listingId: z.uuid("Invalid listing ID"),
    body: messageBody,
    quickReplyKey,
    clientId,
  })
  .refine(hasContent, {
    message: "Write a message or pick a quick reply",
    path: ["body"],
  });

export const SendMessageZodSchema = z
  .object({
    body: messageBody,
    quickReplyKey,
    clientId,
  })
  .refine(hasContent, { message: "Message cannot be empty", path: ["body"] });

export const SendImagesZodSchema = z.object({
  clientIds: z
    .array(z.uuid("Invalid client message ID"))
    .max(MAX_CHAT_IMAGES)
    .optional(),
});

export const ArchiveConversationZodSchema = z.object({
  archived: z.boolean({ message: "archived must be true or false" }),
});

export const ConversationParamZodSchema = z.object({
  id: z.uuid("Invalid conversation ID"),
});

export const MessagesQueryZodSchema = z.object({
  before: z.uuid("Invalid cursor").optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MESSAGES_MAX_LIMIT)
    .default(MESSAGES_DEFAULT_LIMIT),
});

// socket payloads carry the conversation id in the body
export const SocketSendMessageZodSchema = SendMessageZodSchema.and(
  z.object({ conversationId: z.uuid("Invalid conversation ID") }),
);

export const SocketConversationZodSchema = z.object({
  conversationId: z.uuid("Invalid conversation ID"),
});
