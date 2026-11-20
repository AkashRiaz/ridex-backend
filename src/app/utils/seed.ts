import bcrypt from "bcrypt";
import { AuthProvider, Role, UserStatus } from "../../generated/prisma/enums";
import { config } from "../config";
import { prisma } from "../lib/prisma";

// ============================================
// Seed Super Admin (runs on every boot, idempotent)
// ============================================

export const seedSuperAdmin = async () => {
  try {
    const isSuperAdminExist = await prisma.user.findFirst({
      where: {
        role: Role.SUPER_ADMIN,
      },
    });

    if (isSuperAdminExist) {
      console.log("Super Admin Already Exists!");
      return;
    }

    const name = config.super_admin_name;
    const email = config.super_admin_email;
    const password = config.super_admin_password;

    if (!name || !email || !password) {
      throw new Error(
        "Super Admin Name, Email, Password Missing In Env File!!!",
      );
    }

    const hashedPassword = await bcrypt.hash(
      password,
      Number(config.bcrypt_salt_rounds),
    );

    const superAdmin = await prisma.user.create({
      data: {
        name,
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        role: Role.SUPER_ADMIN,
        authProvider: AuthProvider.CREDENTIALS,
        status: UserStatus.ACTIVE,
        needPasswordChange: false,
        emailVerified: true,
      },
    });

    console.log("Super Admin Created:", superAdmin.email);
  } catch (error) {
    console.log("Error Seeding Super Admin:", error);
  }
};
