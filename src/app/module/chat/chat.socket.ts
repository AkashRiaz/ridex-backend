import { TAppSocket, emitToUser, revalidateSocketUser } from "../../lib/socket";
import { AppError } from "../../utils/AppError";
import { CHAT_ROLES } from "./chat.utils";
import { ChatService } from "./chat.service";
import {
  SocketConversationZodSchema,
  SocketSendMessageZodSchema,
} from "./chat.validation";

/*
 * Client → server chat events. Writes go through ChatService, exactly like
 * REST, so the rules (participants, blocks, rate limits) live in one place.
 *
 *   message:send       { conversationId, body?, quickReplyKey?, clientId? }  ack → { success, data | message }
 *   typing:start/stop  { conversationId }
 *   conversation:read  { conversationId }                                    ack → { success }
 */

type TAck = (response: {
  success: boolean;
  statusCode?: number;
  message?: string;
  data?: unknown;
}) => void;

const TYPING_THROTTLE_MS = 2000;

const toAckError = (error: unknown) => ({
  success: false,
  statusCode: error instanceof AppError ? error.statusCode : 500,
  message:
    error instanceof AppError
      ? error.message
      : "Something went wrong. Please try again.",
});

const safeAck = (ack: unknown): TAck =>
  typeof ack === "function" ? (ack as TAck) : () => undefined;

export const registerChatSocketHandlers = (socket: TAppSocket) => {
  if (!CHAT_ROLES.includes(socket.data.user.role)) return;

  // conversationId → counterpartId, so typing events need one DB lookup per thread
  const counterpartCache = new Map<string, string>();
  const lastTypingAt = new Map<string, number>();

  const resolveCounterpart = async (conversationId: string) => {
    const cached = counterpartCache.get(conversationId);
    if (cached) return cached;

    const counterpartId = await ChatService.getCounterpartId(
      socket.data.user.userId,
      conversationId,
    );
    if (counterpartId) counterpartCache.set(conversationId, counterpartId);

    return counterpartId;
  };

  socket.on("message:send", async (payload: unknown, ack: unknown) => {
    const reply = safeAck(ack);
    const parsed = SocketSendMessageZodSchema.safeParse(payload);

    if (!parsed.success) {
      reply({
        success: false,
        statusCode: 400,
        message: parsed.error.issues.map((issue) => issue.message).join(", "),
      });
      return;
    }

    const user = await revalidateSocketUser(socket);
    if (!user) return;

    try {
      const { conversationId, ...message } = parsed.data;
      const data = await ChatService.sendMessage(user, conversationId, message);
      reply({ success: true, statusCode: 201, data });
    } catch (error) {
      reply(toAckError(error));
    }
  });

  const handleTyping = (isTyping: boolean) => async (payload: unknown) => {
    const parsed = SocketConversationZodSchema.safeParse(payload);
    if (!parsed.success) return;

    const { conversationId } = parsed.data;

    if (isTyping) {
      const now = Date.now();
      if (now - (lastTypingAt.get(conversationId) ?? 0) < TYPING_THROTTLE_MS)
        return;
      lastTypingAt.set(conversationId, now);
    } else {
      lastTypingAt.delete(conversationId);
    }

    try {
      const counterpartId = await resolveCounterpart(conversationId);
      if (!counterpartId) return;

      emitToUser(counterpartId, "typing", {
        conversationId,
        userId: socket.data.user.userId,
        isTyping,
      });
    } catch (error) {
      console.error("Typing event failed:", error);
    }
  };

  socket.on("typing:start", handleTyping(true));
  socket.on("typing:stop", handleTyping(false));

  socket.on("conversation:read", async (payload: unknown, ack: unknown) => {
    const reply = safeAck(ack);
    const parsed = SocketConversationZodSchema.safeParse(payload);

    if (!parsed.success) {
      reply({
        success: false,
        statusCode: 400,
        message: "Invalid conversation ID",
      });
      return;
    }

    const user = await revalidateSocketUser(socket);
    if (!user) return;

    try {
      const data = await ChatService.markAsRead(
        user.userId,
        parsed.data.conversationId,
      );
      reply({ success: true, statusCode: 200, data });
    } catch (error) {
      reply(toAckError(error));
    }
  });

  socket.on("disconnect", () => {
    // the other side should not see "typing…" forever
    for (const conversationId of lastTypingAt.keys()) {
      const counterpartId = counterpartCache.get(conversationId);
      if (counterpartId) {
        emitToUser(counterpartId, "typing", {
          conversationId,
          userId: socket.data.user.userId,
          isTyping: false,
        });
      }
    }
  });
};
