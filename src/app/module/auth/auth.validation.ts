import { z } from "zod";
import { normalizePhone } from "../../helper/normalizePhone";

/*
 * Shared field schemas
 */

export const PasswordZodSchema = z
  .string({ message: "Password is required" })
  .min(8, "Password Must Minimum 8 Characters Long.")
  .max(64, "Password must be at most 64 characters long")
  .regex(/[a-z]/, "Password must contain atleast 1 Lowercase Letter")
  .regex(/[A-Z]/, "Password must contain atleast 1 Uppercase Letter")
  .regex(/[0-9]/, "Password must contain atleast 1 Number")
  .regex(/[^A-Za-z0-9]/, "Password must contain atleast 1 Special Character");

export const PhoneZodSchema = z
  .string({ message: "Phone number is required" })
  .trim()
  .transform((value, ctx) => {
    const phone = normalizePhone(value);

    if (!phone) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid Bangladeshi mobile number (01XXXXXXXXX)",
      });
      return z.NEVER;
    }

    return phone;
  });

const EmailZodSchema = z
  .email("Email must be a valid email address")
  .trim()
  .toLowerCase();

const OtpZodSchema = z
  .string({ message: "OTP is required" })
  .trim()
  .regex(/^\d{6}$/, "OTP must be 6 digits long");

// email or phone; services decide which one it is
const IdentifierZodSchema = z
  .string({ message: "Email or phone number is required" })
  .trim()
  .min(1, "Email or phone number is required");

const PhoneOtpPurposeZodSchema = z.enum(["VERIFY", "LOGIN"], {
  message: "Purpose must be VERIFY or LOGIN",
});

/*
 * Request schemas
 */

export const RegisterZodSchema = z
  .object({
    name: z
      .string({ message: "Name is required" })
      .trim()
      .min(2, "Name must be at least 2 characters long")
      .max(80, "Name must be at most 80 characters long"),

    email: EmailZodSchema.optional(),

    phone: PhoneZodSchema.optional(),

    password: PasswordZodSchema,

    role: z.enum(["BUYER", "SELLER", "DEALER"], {
      message: "Role must be BUYER, SELLER or DEALER",
    }),
  })
  .refine((data) => data.email || data.phone, {
    message: "Email or phone number is required",
    path: ["email"],
  });

export const LoginZodSchema = z.object({
  identifier: IdentifierZodSchema,
  password: z
    .string({ message: "Password is required" })
    .min(1, "Password is required"),
});

export const EmailVerifyZodSchema = z.object({
  email: EmailZodSchema,
  otp: OtpZodSchema,
});

export const ResendEmailOtpZodSchema = z.object({
  email: EmailZodSchema,
});

export const SendPhoneOtpZodSchema = z.object({
  phone: PhoneZodSchema,
  purpose: PhoneOtpPurposeZodSchema,
});

export const VerifyPhoneOtpZodSchema = z.object({
  phone: PhoneZodSchema,
  otp: OtpZodSchema,
  purpose: PhoneOtpPurposeZodSchema,
});

export const GoogleLoginZodSchema = z.object({
  idToken: z
    .string({ message: "Google ID token is required" })
    .min(1, "Google ID token is required"),
});

export const ChangePasswordZodSchema = z
  .object({
    // optional only for Google-only accounts that have no password yet
    oldPassword: z.string().min(1, "Current password is required").optional(),
    newPassword: PasswordZodSchema,
  })
  .refine((data) => data.oldPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export const ForgotPasswordZodSchema = z.object({
  identifier: IdentifierZodSchema,
});

export const ResetPasswordZodSchema = z.object({
  identifier: IdentifierZodSchema,
  otp: OtpZodSchema,
  newPassword: PasswordZodSchema,
});
