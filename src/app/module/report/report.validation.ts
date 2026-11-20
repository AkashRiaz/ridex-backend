import { z } from "zod";
import { REPORT_ACTIONS } from "./report.interface";

export const CreateReportZodSchema = z.object({
  targetType: z.enum(["LISTING", "USER", "REVIEW", "MESSAGE"], {
    message: "Choose what you are reporting",
  }),
  targetId: z.uuid("Invalid target ID"),
  reason: z.enum(
    ["SCAM", "FAKE_LISTING", "WRONG_INFO", "DUPLICATE", "ALREADY_SOLD", "OFFENSIVE", "HARASSMENT", "SPAM", "OTHER"],
    { message: "Choose a reason" },
  ),
  details: z.string().trim().max(1000, "Details must be at most 1000 characters").optional(),
});

export const UpdateReportZodSchema = z
  .object({
    status: z.enum(["IN_REVIEW", "RESOLVED", "DISMISSED"], {
      message: "Status must be IN_REVIEW, RESOLVED or DISMISSED",
    }),
    resolutionNote: z.string().trim().max(500, "Note must be at most 500 characters").optional(),
    action: z.enum(REPORT_ACTIONS, { message: "Invalid action" }).optional(),
  })
  .refine((data) => data.status === "IN_REVIEW" || Boolean(data.resolutionNote), {
    message: "Add a note explaining the decision",
    path: ["resolutionNote"],
  })
  .refine((data) => data.status === "RESOLVED" || !data.action || data.action === "NONE", {
    message: "Actions can only be taken when resolving a report",
    path: ["action"],
  });
