import { Gender, Role, UserStatus } from "../../../generated/prisma/enums";

export interface IUpdateMyProfilePayload {
  name?: string;
  bio?: string | null;
  gender?: Gender | null;
  dateOfBirth?: Date | null;
  division?: string | null;
  district?: string | null;
  area?: string | null;
}

export interface IDeleteMyAccountPayload {
  password?: string;
}

export interface ICreateUserPayload {
  name: string;
  email: string;
  phone?: string;
  role: Role;
}

export interface IUpdateUserStatusPayload {
  status: Extract<UserStatus, "ACTIVE" | "BLOCKED">;
  reason?: string;
}

export interface IUpdateUserRolePayload {
  role: Role;
}
