import { Role } from "../../../generated/prisma/enums";

export type TSelfRegisterRole = Extract<Role, "BUYER" | "SELLER" | "DEALER">;

export type TPhoneOtpPurpose = "VERIFY" | "LOGIN";

export interface IRequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface IRegisterPayload {
  name: string;
  email?: string;
  phone?: string;
  password: string;
  role: TSelfRegisterRole;
}

export interface ILoginUserPayload {
  // email address or phone number
  identifier: string;
  password: string;
}

export interface IVerifyEmailPayload {
  email: string;
  otp: string;
}

export interface IResendEmailOtpPayload {
  email: string;
}

export interface ISendPhoneOtpPayload {
  phone: string;
  purpose: TPhoneOtpPurpose;
}

export interface IVerifyPhoneOtpPayload {
  phone: string;
  otp: string;
  purpose: TPhoneOtpPurpose;
}

export interface IGoogleLoginPayload {
  idToken: string;
}

export interface IChangePasswordPayload {
  oldPassword?: string;
  newPassword: string;
}

export interface IForgotPasswordPayload {
  identifier: string;
}

export interface IResetPasswordPayload {
  identifier: string;
  otp: string;
  newPassword: string;
}
