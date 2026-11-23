import { z } from "zod";
import { PhoneZodSchema } from "../auth/auth.validation";
import {
  LOAN_NOTE_MAX,
  LOAN_RATE_MAX_PERCENT,
  LOAN_TENURE_MAX_MONTHS,
  LOAN_TENURE_MIN_MONTHS,
} from "./loanLead.utils";

const NoteZodSchema = z
  .string()
  .trim()
  .max(LOAN_NOTE_MAX, `Note must be at most ${LOAN_NOTE_MAX} characters`);

export const CreateLoanLeadZodSchema = z.object({
  listingId: z.uuid("Invalid listing ID"),
  preferredPartnerId: z.uuid("Invalid finance partner ID").optional(),
  downPayment: z.coerce
    .number({ message: "Down payment must be a number" })
    .min(0, "Down payment cannot be negative"),
  tenureMonths: z.coerce
    .number({ message: "Tenure must be a number" })
    .int("Tenure must be a whole number of months")
    .min(
      LOAN_TENURE_MIN_MONTHS,
      `Tenure must be at least ${LOAN_TENURE_MIN_MONTHS} months`,
    )
    .max(
      LOAN_TENURE_MAX_MONTHS,
      `Tenure must be at most ${LOAN_TENURE_MAX_MONTHS} months`,
    ),
  interestRate: z.coerce
    .number({ message: "Interest rate must be a number" })
    .min(0, "Interest rate cannot be negative")
    .max(
      LOAN_RATE_MAX_PERCENT,
      `Interest rate must be at most ${LOAN_RATE_MAX_PERCENT}%`,
    ),
  fullName: z
    .string({ message: "Full name is required" })
    .trim()
    .min(2, "Full name is required")
    .max(80, "Full name must be at most 80 characters"),
  phone: PhoneZodSchema,
  email: z.email("Enter a valid email address").trim().toLowerCase().optional(),
  district: z.string().trim().max(60).optional(),
  monthlyIncome: z.coerce
    .number({ message: "Monthly income must be a number" })
    .min(0, "Monthly income cannot be negative")
    .max(100_000_000, "Monthly income looks too high")
    .optional(),
  employmentType: z.enum(
    ["SALARIED", "SELF_EMPLOYED", "BUSINESS", "STUDENT", "OTHER"],
    { message: "Choose your employment type" },
  ),
  note: NoteZodSchema.optional(),
  consent: z.literal(true, {
    message: "Agree to share your details with a finance partner",
  }),
});

export const AssignLoanLeadZodSchema = z.object({
  partnerId: z.uuid("Choose a finance partner"),
  note: NoteZodSchema.optional(),
});

export const UpdateLoanLeadStatusZodSchema = z
  .object({
    status: z.enum(
      ["CONTACTED", "APPROVED", "REJECTED", "DISBURSED", "CLOSED"],
      {
        message:
          "Status must be CONTACTED, APPROVED, REJECTED, DISBURSED or CLOSED",
      },
    ),
    note: NoteZodSchema.optional(),
    partnerReference: z
      .string()
      .trim()
      .max(60, "Partner reference must be at most 60 characters")
      .optional(),
  })
  .refine(
    (data) =>
      !["REJECTED", "CLOSED"].includes(data.status) || Boolean(data.note),
    {
      message: "Add a reason the buyer will see",
      path: ["note"],
    },
  );

export const WithdrawLoanLeadZodSchema = z.object({
  reason: NoteZodSchema.optional(),
});
