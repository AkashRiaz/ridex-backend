import { z } from "zod";

const category = z.enum(
  ["MESSAGES", "LISTINGS", "PRICE_ALERTS", "REVIEWS", "ACCOUNT"],
  {
    message: "Invalid notification category",
  },
);

export const UpdatePreferencesZodSchema = z.object({
  preferences: z
    .array(
      z
        .object({
          category,
          inApp: z
            .boolean({ message: "inApp must be true or false" })
            .optional(),
          email: z
            .boolean({ message: "email must be true or false" })
            .optional(),
        })
        .refine(
          (data) => data.inApp !== undefined || data.email !== undefined,
          {
            message: "Choose a channel to change",
          },
        ),
    )
    .min(1, "Nothing to update")
    .max(10),
});

export const UnsubscribeZodSchema = z.object({
  token: z
    .string({ message: "Token is required" })
    .trim()
    .min(20, "Invalid unsubscribe link")
    .max(1000),
});

export const NotificationParamZodSchema = z.object({
  id: z.uuid("Invalid notification ID"),
});
