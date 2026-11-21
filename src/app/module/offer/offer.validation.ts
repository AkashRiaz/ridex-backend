import { z } from "zod";
import { OfferStatus } from "../../../generated/prisma/enums";
import {
  MAX_DECLINE_REASON_LENGTH,
  MAX_OFFER_MESSAGE_LENGTH,
} from "./offer.utils";

// whole currency units; price bounds are checked in the service
const amount = z.coerce
  .number({ message: "Amount must be a number" })
  .int("Amount must be a whole number")
  .positive("Amount must be greater than 0")
  .max(9_999_999_999, "Amount is too large");

const message = z
  .string()
  .trim()
  .max(
    MAX_OFFER_MESSAGE_LENGTH,
    `A note can be at most ${MAX_OFFER_MESSAGE_LENGTH} characters`,
  )
  .optional();

export const CreateOfferZodSchema = z.object({
  listingId: z.uuid("Invalid listing ID"),
  amount,
  message,
});

export const CounterOfferZodSchema = z.object({
  amount,
  message,
});

export const DeclineOfferZodSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(
      MAX_DECLINE_REASON_LENGTH,
      `A reason can be at most ${MAX_DECLINE_REASON_LENGTH} characters`,
    )
    .optional(),
});

export const OfferParamZodSchema = z.object({
  id: z.uuid("Invalid offer ID"),
});

export const OfferQueryZodSchema = z.object({
  as: z.enum(["buyer", "seller"]).optional(),
  status: z.enum(OfferStatus).optional(),
  listingId: z.uuid("Invalid listing ID").optional(),
  conversationId: z.uuid("Invalid conversation ID").optional(),
});
