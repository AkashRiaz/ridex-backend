import { z } from "zod";

export const CreateQuickReplyZodSchema = z.object({
  text: z
    .string({ message: "Reply text is required" })
    .trim()
    .min(1, "Reply text is required")
    .max(300, "A quick reply can be at most 300 characters"),
});

export const UpdateQuickReplyZodSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "Reply text is required")
      .max(300, "A quick reply can be at most 300 characters")
      .optional(),
    sortOrder: z.coerce.number().int("Order must be a whole number").min(0).max(100).optional(),
  })
  .refine((data) => data.text !== undefined || data.sortOrder !== undefined, {
    message: "Nothing to update",
  });

export const QuickReplyParamZodSchema = z.object({
  id: z.uuid("Invalid quick reply ID"),
});
