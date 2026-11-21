import { z } from "zod";

const RatingZodSchema = z.coerce
  .number({ message: "Rating must be a number" })
  .int("Rating must be a whole number")
  .min(1, "Rating must be between 1 and 5")
  .max(5, "Rating must be between 1 and 5");

const CommentZodSchema = z
  .string()
  .trim()
  .max(1000, "Review must be at most 1000 characters");

export const CreateReviewZodSchema = z.object({
  listingId: z.uuid("Invalid listing ID"),
  rating: RatingZodSchema,
  comment: CommentZodSchema.default(""),
});

export const UpdateReviewZodSchema = z
  .object({
    rating: RatingZodSchema.optional(),
    comment: CommentZodSchema.optional(),
  })
  .refine((data) => data.rating !== undefined || data.comment !== undefined, {
    message: "Change the rating or the comment",
  });

export const ReplyToReviewZodSchema = z.object({
  reply: z
    .string({ message: "Reply is required" })
    .trim()
    .min(1, "Reply is required")
    .max(1000, "Reply must be at most 1000 characters"),
});

export const ReviewVisibilityZodSchema = z
  .object({
    isHidden: z.boolean({ message: "isHidden must be true or false" }),
    reason: z
      .string()
      .trim()
      .max(300, "Reason must be at most 300 characters")
      .optional(),
  })
  .refine((data) => !data.isHidden || Boolean(data.reason), {
    message: "A reason is required when hiding a review",
    path: ["reason"],
  });
