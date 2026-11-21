import { z } from "zod";
import { PhoneZodSchema } from "../auth/auth.validation";

const nullableText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters long`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const UpdateMyProfileZodSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(80, "Name must be at most 80 characters long")
    .optional(),

  bio: nullableText(500, "Bio"),

  gender: z
    .enum(["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"], {
      message: "Invalid gender",
    })
    .nullable()
    .optional(),

  dateOfBirth: z.coerce
    .date({ message: "Invalid date of birth" })
    .max(new Date(), "Date of birth cannot be in the future")
    .nullable()
    .optional(),

  division: nullableText(60, "Division"),

  district: nullableText(60, "District"),

  area: nullableText(100, "Area"),
});

export const DeleteMyAccountZodSchema = z.object({
  // required for accounts that have a password (checked in the service)
  password: z.string().min(1, "Password is required").optional(),
});

/*
 * Staff / manual account creation by admins.
 * SUPER_ADMIN and DEALER_STAFF can never be created here.
 */
export const CreateUserZodSchema = z.object({
  name: z
    .string({ message: "Name is required" })
    .trim()
    .min(2, "Name must be at least 2 characters long")
    .max(80, "Name must be at most 80 characters long"),

  email: z.email("Invalid email address").trim().toLowerCase(),

  phone: PhoneZodSchema.optional(),

  role: z.enum(
    ["ADMIN", "MODERATOR", "INSPECTOR", "DEALER", "SELLER", "BUYER"],
    {
      message: "Invalid role",
    },
  ),
});

export const UpdateUserStatusZodSchema = z
  .object({
    status: z.enum(["ACTIVE", "BLOCKED"], {
      message: "Status must be ACTIVE or BLOCKED",
    }),

    reason: z
      .string()
      .trim()
      .max(300, "Reason must be at most 300 characters long")
      .optional(),
  })
  .refine((data) => data.status !== "BLOCKED" || Boolean(data.reason), {
    message: "A reason is required when blocking a user",
    path: ["reason"],
  });

export const UpdateUserRoleZodSchema = z.object({
  role: z.enum(
    ["ADMIN", "MODERATOR", "INSPECTOR", "DEALER", "SELLER", "BUYER"],
    {
      message: "Invalid role",
    },
  ),
});
