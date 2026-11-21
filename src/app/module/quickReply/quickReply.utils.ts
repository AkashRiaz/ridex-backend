/*
 * Built-in quick replies per conversation side.
 * Keys are stored on the message (quickReplyKey) for analytics;
 * the text is resolved here so it can be reworded without a migration.
 */
export type TQuickReplySide = "buyer" | "seller";

export type TBuiltInQuickReply = {
  key: string;
  text: string;
};

export const BUILT_IN_QUICK_REPLIES: Record<
  TQuickReplySide,
  TBuiltInQuickReply[]
> = {
  buyer: [
    { key: "IS_AVAILABLE", text: "Hi, is this still available?" },
    { key: "BEST_PRICE", text: "What is your best price?" },
    { key: "SEE_TODAY", text: "Can I come and see it today?" },
    { key: "TEST_RIDE", text: "Can I take a test ride?" },
    { key: "PAPERS", text: "Are all the papers up to date?" },
    { key: "WHERE", text: "Where can I see it?" },
  ],
  seller: [
    { key: "YES_AVAILABLE", text: "Yes, it's still available." },
    { key: "PRICE_FIXED", text: "Sorry, the price is fixed." },
    { key: "PRICE_NEGOTIABLE", text: "The price is a little negotiable." },
    { key: "COME_SEE", text: "You're welcome to come and see it." },
    { key: "ALREADY_SOLD", text: "Sorry, it has already been sold." },
  ],
};

export const MAX_CUSTOM_QUICK_REPLIES = 10;

export const findBuiltInQuickReply = (side: TQuickReplySide, key: string) =>
  BUILT_IN_QUICK_REPLIES[side].find((reply) => reply.key === key) ?? null;
