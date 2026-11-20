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
import { Prisma } from "../../generated/prisma/client";
import { AuthProvider, Role, UserStatus } from "../../generated/prisma/enums";
import { config } from "../config";
import { validateSpecs } from "../helper/buildDynamicSpecSchema";
import { generateSlug } from "../helper/generateSlug";
import { prisma } from "../lib/prisma";
import { parseAttributes } from "../module/vehicleType/vehicleType.utils";
import { VehicleAttributesZodSchema } from "../module/vehicleType/vehicleType.validation";
import { seedSuperAdmin } from "./seed";
import {
  BIKE_ATTRIBUTES,
  BIKE_BRANDS,
  BIKE_VEHICLE_TYPE,
} from "./seedData/bikeCatalog";

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
// Vehicle types (bike first)
// ============================================

/*
 * Creates the bike vehicle type if missing.
 * An existing type is never overwritten, so admin edits are kept.
 */
export const seedVehicleTypes = async () => {
  const existing = await prisma.vehicleType.findUnique({
    where: { slug: BIKE_VEHICLE_TYPE.slug },
  });

  if (existing) {
    console.log("Bike vehicle type already exists!");
    return existing;
  }

  // same validation + normalisation as the API
  const attributes = VehicleAttributesZodSchema.parse(BIKE_ATTRIBUTES);

  const vehicleType = await prisma.vehicleType.create({
    data: {
      ...BIKE_VEHICLE_TYPE,
      attributes: attributes as unknown as Prisma.InputJsonValue,
    },
  });

  console.log(`Vehicle type created: ${vehicleType.name} (${attributes.length} attributes)`);

  return vehicleType;
};

// ============================================
// Brands + models
// ============================================

export const seedBrandsAndModels = async () => {
  const bikeType = await prisma.vehicleType.findUniqueOrThrow({
    where: { slug: BIKE_VEHICLE_TYPE.slug },
  });

  const attributes = parseAttributes(bikeType.attributes);

  let brandCount = 0;
  let modelCount = 0;

  for (const seedBrand of BIKE_BRANDS) {
    const slug = generateSlug(seedBrand.name);

    let brand = await prisma.brand.findUnique({ where: { slug } });

    if (!brand) {
      brand = await prisma.brand.create({
        data: {
          name: seedBrand.name,
          slug,
          country: seedBrand.country,
          isPopular: seedBrand.isPopular,
        },
      });
      brandCount += 1;
    }

    // make sure the brand is linked to bikes
    await prisma.brandVehicleType.upsert({
      where: {
        brandId_vehicleTypeId: { brandId: brand.id, vehicleTypeId: bikeType.id },
      },
      create: { brandId: brand.id, vehicleTypeId: bikeType.id },
      update: {},
    });

    for (const seedModel of seedBrand.models) {
      const existingModel = await prisma.vehicleModel.findUnique({
        where: { brandId_name: { brandId: brand.id, name: seedModel.name } },
      });

      if (existingModel) continue;

      const specs = validateSpecs(attributes, seedModel.specs, { partial: true });

      if (!specs.success) {
        throw new Error(
          `Seed data for ${seedBrand.name} ${seedModel.name} is invalid: ${specs.message}`,
        );
      }

      await prisma.vehicleModel.create({
        data: {
          brandId: brand.id,
          vehicleTypeId: bikeType.id,
          name: seedModel.name,
          slug: generateSlug(seedModel.name),
          yearFrom: seedModel.yearFrom ?? null,
          defaultSpecs: specs.data as Prisma.InputJsonValue,
        },
      });

      modelCount += 1;
    }
  }

  console.log(
    `Brands seeded: ${BIKE_BRANDS.length} (${brandCount} new), models created: ${modelCount}`,
  );
};

// ============================================
// Runner
// ============================================

const runSeed = async () => {
  try {
    await prisma.$connect();

    await seedSuperAdmin();
    await seedDemoUsers();

    await seedVehicleTypes();
    await seedBrandsAndModels();
    // await seedSampleListings();    // Phase 1 · Part 3: listing module

    console.log("Demo seeding completed successfully.");
  } catch (error) {
    console.error("Error running demo seed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

runSeed();
