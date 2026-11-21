import { z } from "zod";

const DocumentKindsZodSchema = z
  .array(
    z.enum(
      [
        "NID_FRONT",
        "NID_BACK",
        "SELFIE",
        "TRADE_LICENSE",
        "TIN_CERTIFICATE",
        "SHOWROOM_PHOTO",
      ],
      {
        message: "Invalid document type",
      },
    ),
    { message: "Document types are required" },
  )
  .min(1, "Upload at least one document")
  .max(8, "At most 8 documents");

export const SubmitVerificationZodSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("ID"),
      fullName: z
        .string({ message: "Name is required" })
        .trim()
        .min(2, "Enter your name as written on the NID")
        .max(80, "Name must be at most 80 characters"),
      // Bangladesh NID: 10 (smart card), 13 or 17 digits — only the last 4 are stored
      nidNumber: z
        .string({ message: "NID number is required" })
        .trim()
        .regex(
          /^(\d{10}|\d{13}|\d{17})$/,
          "NID number must be 10, 13 or 17 digits",
        ),
      documentKinds: DocumentKindsZodSchema,
    }),
    z.object({
      type: z.literal("DEALER"),
      businessName: z
        .string({ message: "Business name is required" })
        .trim()
        .min(2, "Business name is required")
        .max(100, "Business name must be at most 100 characters"),
      tradeLicenseNumber: z
        .string({ message: "Trade license number is required" })
        .trim()
        .min(3, "Trade license number is required")
        .max(50, "Trade license number must be at most 50 characters"),
      division: z
        .string({ message: "Division is required" })
        .trim()
        .min(1, "Division is required"),
      district: z
        .string({ message: "District is required" })
        .trim()
        .min(1, "District is required"),
      area: z
        .string()
        .trim()
        .max(100, "Area must be at most 100 characters")
        .optional(),
      documentKinds: DocumentKindsZodSchema,
    }),
  ],
  { error: () => "Verification type must be ID or DEALER" },
);

export const ReviewVerificationZodSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"], {
      message: "Status must be APPROVED or REJECTED",
    }),
    reason: z
      .string()
      .trim()
      .max(500, "Reason must be at most 500 characters")
      .optional(),
  })
  .refine((data) => data.status !== "REJECTED" || Boolean(data.reason), {
    message: "Tell the user why the request was rejected",
    path: ["reason"],
  });
