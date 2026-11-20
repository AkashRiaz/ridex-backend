/*
 * Demo data seed. Run with: npm run seed
 * Idempotent: every step checks before inserting, like seed.ts.
 *
 * Steps are filled in as their modules are built:
 *   Phase 1 → seedVehicleTypes, seedBrandsAndModels, seedSampleListings
 *   Phase 2 → seedPlans, seedCmsPages
 *   Phase 3 → seedGroups, seedBadges
 */
import bcrypt from "bcrypt";
import { AuthProvider, Role, UserStatus } from "../../generated/prisma/enums";
import { config } from "../config";
import { prisma } from "../lib/prisma";
import { seedSuperAdmin } from "./seed";

// ============================================
// Demo Users (one per role)
// ============================================

const DEMO_USERS: { name: string; email: string; role: Role }[] = [
  { name: "Demo Admin", email: "admin@ridex.demo", role: Role.ADMIN },
  { name: "Demo Moderator", email: "moderator@ridex.demo", role: Role.MODERATOR },
  { name: "Demo Dealer", email: "dealer@ridex.demo", role: Role.DEALER },
  { name: "Demo Dealer Staff", email: "dealer.staff@ridex.demo", role: Role.DEALER_STAFF },
  { name: "Demo Seller", email: "seller@ridex.demo", role: Role.SELLER },
  { name: "Demo Inspector", email: "inspector@ridex.demo", role: Role.INSPECTOR },
  { name: "Demo Buyer", email: "buyer@ridex.demo", role: Role.BUYER },
];

export const seedDemoUsers = async () => {
  const password = config.demo_user_password;

  if (!password) {
    throw new Error("DEMO_USER_PASSWORD Missing In Env File!!!");
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  for (const demoUser of DEMO_USERS) {
    const isUserExist = await prisma.user.findUnique({
      where: { email: demoUser.email },
    });

    if (isUserExist) {
      console.log(`${demoUser.role} demo user already exists!`);
      continue;
    }

    await prisma.user.create({
      data: {
        name: demoUser.name,
        email: demoUser.email,
        password: hashedPassword,
        role: demoUser.role,
        authProvider: AuthProvider.CREDENTIALS,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      },
    });

    console.log(`${demoUser.role} demo user created: ${demoUser.email}`);
  }
};

// ============================================
// Runner
// ============================================

const runSeed = async () => {
  try {
    await prisma.$connect();

    await seedSuperAdmin();
    await seedDemoUsers();

    // await seedVehicleTypes();      // Phase 1: vehicleType module
    // await seedBrandsAndModels();   // Phase 1: brand + vehicleModel modules
    // await seedSampleListings();    // Phase 1: listing module

    console.log("Demo seeding completed successfully.");
  } catch (error) {
    console.error("Error running demo seed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

runSeed();
