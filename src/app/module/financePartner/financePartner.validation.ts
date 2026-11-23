import { z } from "zod";
import {
  LOAN_RATE_MAX_PERCENT,
  LOAN_TENURE_MAX_MONTHS,
  LOAN_TENURE_MIN_MONTHS,
} from "../loanLead/loanLead.utils";

const SlugZodSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Slug must be lowercase words separated by -",
  )
  .max(80, "Slug must be at most 80 characters");

const RateZodSchema = z.coerce
  .number({ message: "Interest rate must be a number" })
  .min(0, "Interest rate cannot be negative")
  .max(
    LOAN_RATE_MAX_PERCENT,
    `Interest rate must be at most ${LOAN_RATE_MAX_PERCENT}%`,
  );

const MinDownPaymentZodSchema = z.coerce
  .number({ message: "Minimum down payment must be a number" })
  .int("Minimum down payment must be a whole percent")
  .min(0, "Minimum down payment cannot be negative")
  .max(90, "Minimum down payment must be at most 90%");

const MaxTenureZodSchema = z.coerce
  .number({ message: "Maximum tenure must be a number" })
  .int("Maximum tenure must be a whole number of months")
  .min(
    LOAN_TENURE_MIN_MONTHS,
    `Maximum tenure must be at least ${LOAN_TENURE_MIN_MONTHS} months`,
  )
  .max(
    LOAN_TENURE_MAX_MONTHS,
    `Maximum tenure must be at most ${LOAN_TENURE_MAX_MONTHS} months`,
  );

const WebsiteZodSchema = z.url("Enter a valid website URL").trim().max(200);

const rateRangeRefine = {
  check: (data: { interestRateMin?: number; interestRateMax?: number }) =>
    data.interestRateMin === undefined ||
    data.interestRateMax === undefined ||
    data.interestRateMin <= data.interestRateMax,
  message: {
    message: "The lowest rate cannot be higher than the highest rate",
    path: ["interestRateMax"],
  },
};

export const CreateFinancePartnerZodSchema = z
  .object({
    name: z
      .string({ message: "Partner name is required" })
      .trim()
      .min(2, "Partner name is required")
      .max(80, "Partner name must be at most 80 characters"),
    slug: SlugZodSchema.optional(),
    description: z.string().trim().max(500).optional(),
    contactEmail: z.email("Enter a valid contact email").trim().toLowerCase(),
    contactPhone: z.string().trim().max(30).optional(),
    website: WebsiteZodSchema.optional(),
    interestRateMin: RateZodSchema,
    interestRateMax: RateZodSchema,
    minDownPaymentPercent: MinDownPaymentZodSchema,
    maxTenureMonths: MaxTenureZodSchema,
    isActive: z.boolean().default(true),
  })
  .refine(rateRangeRefine.check, rateRangeRefine.message);

export const UpdateFinancePartnerZodSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Partner name cannot be empty")
      .max(80, "Partner name must be at most 80 characters")
      .optional(),
    slug: SlugZodSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    contactEmail: z
      .email("Enter a valid contact email")
      .trim()
      .toLowerCase()
      .optional(),
    contactPhone: z.string().trim().max(30).nullable().optional(),
    website: WebsiteZodSchema.nullable().optional(),
    interestRateMin: RateZodSchema.optional(),
    interestRateMax: RateZodSchema.optional(),
    minDownPaymentPercent: MinDownPaymentZodSchema.optional(),
    maxTenureMonths: MaxTenureZodSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(rateRangeRefine.check, rateRangeRefine.message);
