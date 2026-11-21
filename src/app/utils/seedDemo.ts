/*
 * Demo data seed. Run with: npm run seed
 * Idempotent: every step checks before inserting, like seed.ts.
 *
 * Steps are filled in as their modules are built:
 *   Phase 1 → seedVehicleTypes, seedBrandsAndModels, seedSampleListings, seedDemoConversations
 *   Phase 2 → seedPlans, seedCmsPages
 *   Phase 3 → seedGroups, seedBadges
 */
import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client";
import {
  AuthProvider,
  ListingStatus,
  NotificationCategory,
  NotificationType,
  Role,
  UserStatus,
} from "../../generated/prisma/enums";
import { config } from "../config";
import { validateSpecs } from "../helper/buildDynamicSpecSchema";
import { findDistrict } from "../helper/bdLocations";
import { generateSlug } from "../helper/generateSlug";
import { prisma } from "../lib/prisma";
import { syncSearch } from "../module/listing/listing.service";
import { generateListingSlug } from "../module/listing/listing.utils";
import { parseAttributes } from "../module/vehicleType/vehicleType.utils";
import { VehicleAttributesZodSchema } from "../module/vehicleType/vehicleType.validation";
import { seedSuperAdmin } from "./seed";
import {
  BIKE_ATTRIBUTES,
  BIKE_BRANDS,
  BIKE_VEHICLE_TYPE,
} from "./seedData/bikeCatalog";
import { SAMPLE_LISTINGS } from "./seedData/sampleListings";

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
// Sample listings
// ============================================

/*
 * Approved demo listings by the demo seller and dealer.
 * Idempotent per sample (seller + model + year + price), so an interrupted run can resume.
 */
export const seedSampleListings = async () => {
  const [seller, dealer] = await Promise.all([
    prisma.user.findUnique({ where: { email: "seller@ridex.demo" } }),
    prisma.user.findUnique({ where: { email: "dealer@ridex.demo" } }),
  ]);

  if (!seller || !dealer) {
    console.log("Demo seller/dealer missing — skipping sample listings.");
    return;
  }

  const bikeType = await prisma.vehicleType.findUniqueOrThrow({
    where: { slug: BIKE_VEHICLE_TYPE.slug },
  });

  const attributes = parseAttributes(bikeType.attributes);
  const expiresAt = new Date(Date.now() + config.listing_duration_days * 24 * 60 * 60 * 1000);
  let created = 0;

  for (const [index, sample] of SAMPLE_LISTINGS.entries()) {
    const brand = await prisma.brand.findUnique({ where: { slug: sample.brand } });
    const model = brand
      ? await prisma.vehicleModel.findUnique({
          where: { brandId_slug: { brandId: brand.id, slug: sample.model } },
        })
      : null;

    if (!brand || !model) {
      console.log(`Skipping sample listing: ${sample.brand}/${sample.model} not found`);
      continue;
    }

    const sellerId = sample.seller === "dealer" ? dealer.id : seller.id;

    const alreadySeeded = await prisma.listing.findFirst({
      where: { sellerId, vehicleModelId: model.id, year: sample.year, price: sample.price },
      select: { id: true },
    });

    if (alreadySeeded) continue;

    const specs = validateSpecs(attributes, model.defaultSpecs);

    if (!specs.success) {
      throw new Error(`Sample listing ${model.name} has invalid specs: ${specs.message}`);
    }

    const centre = findDistrict(sample.division, sample.district);

    if (!centre) {
      throw new Error(`Sample listing ${model.name} has an invalid location`);
    }

    // spread approval dates over the last few weeks for realistic "newest" sorting
    const approvedAt = new Date(Date.now() - index * 26 * 60 * 60 * 1000);

    const listing = await prisma.listing.create({
      data: {
        slug: generateListingSlug([brand.name, model.name, sample.year]),
        sellerId,
        vehicleTypeId: bikeType.id,
        brandId: brand.id,
        vehicleModelId: model.id,
        title: `${brand.name} ${model.name} ${sample.year}${sample.condition === "NEW" ? " (Brand new)" : ""}`,
        description: sample.description,
        price: sample.price,
        isNegotiable: sample.isNegotiable,
        condition: sample.condition,
        year: sample.year,
        mileage: sample.mileage,
        color: sample.color,
        specs: specs.data as Prisma.InputJsonValue,
        division: sample.division,
        district: sample.district,
        area: sample.area,
        // small offset so pins in one district do not overlap exactly
        latitude: centre.lat + ((index % 5) - 2) * 0.01,
        longitude: centre.lng + ((index % 3) - 1) * 0.01,
        status: ListingStatus.APPROVED,
        submittedAt: approvedAt,
        approvedAt,
        expiresAt,
        viewsCount: (index * 37) % 400,
      },
    });

    await syncSearch(listing.id);
    created += 1;
  }

  console.log(`Sample listings created: ${created} (others already existed)`);
};

// ============================================
// Demo Conversations & Notifications (Phase 1 · Part 5)
// ============================================

type TSeedMessage = { from: "buyer" | "seller"; body: string; minutesAgo: number };

const DEMO_THREADS: { sellerEmail: string; listingIndex: number; messages: TSeedMessage[] }[] = [
  {
    sellerEmail: "seller@ridex.demo",
    listingIndex: 0,
    messages: [
      { from: "buyer", body: "Hi, is this still available?", minutesAgo: 180 },
      { from: "seller", body: "Yes, it's still available.", minutesAgo: 170 },
      { from: "buyer", body: "Are all the papers up to date? Can I see it this weekend?", minutesAgo: 160 },
      { from: "seller", body: "All papers are clear. Saturday afternoon works, I'm in Mirpur.", minutesAgo: 20 },
    ],
  },
  {
    sellerEmail: "dealer@ridex.demo",
    listingIndex: 0,
    messages: [
      { from: "buyer", body: "Can I take a test ride?", minutesAgo: 60 * 26 },
      { from: "seller", body: "You're welcome to come and see it. Our showroom is open 10am to 8pm.", minutesAgo: 60 * 25 },
    ],
  },
];

export const seedDemoConversations = async () => {
  const buyer = await prisma.user.findUnique({ where: { email: "buyer@ridex.demo" } });

  if (!buyer) {
    console.log("Demo buyer missing. Skipping demo conversations.");
    return;
  }

  let created = 0;

  for (const thread of DEMO_THREADS) {
    const seller = await prisma.user.findUnique({ where: { email: thread.sellerEmail } });
    if (!seller) continue;

    const listing = (
      await prisma.listing.findMany({
        where: { sellerId: seller.id, status: ListingStatus.APPROVED, isDeleted: false },
        orderBy: { createdAt: "asc" },
        take: thread.listingIndex + 1,
        select: { id: true },
      })
    )[thread.listingIndex];

    if (!listing) continue;

    const exists = await prisma.conversation.findUnique({
      where: { listingId_buyerId: { listingId: listing.id, buyerId: buyer.id } },
    });

    if (exists) continue;

    const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60 * 1000);
    const last = thread.messages[thread.messages.length - 1];
    // the buyer has read up to their own last message; newer seller replies stay unread
    const lastBuyerMessage = [...thread.messages].reverse().find((message) => message.from === "buyer");
    const buyerUnread = thread.messages.filter(
      (message) => message.from === "seller" && message.minutesAgo < (lastBuyerMessage?.minutesAgo ?? Infinity),
    ).length;

    await prisma.conversation.create({
      data: {
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        lastMessageAt: at(last.minutesAgo),
        lastMessagePreview: last.body.slice(0, 120),
        lastMessageSenderId: last.from === "buyer" ? buyer.id : seller.id,
        buyerUnreadCount: buyerUnread,
        buyerLastReadAt: lastBuyerMessage ? at(lastBuyerMessage.minutesAgo) : null,
        sellerLastReadAt: at(last.minutesAgo),
        createdAt: at(thread.messages[0].minutesAgo),
        messages: {
          create: thread.messages.map((message) => ({
            senderId: message.from === "buyer" ? buyer.id : seller.id,
            body: message.body,
            createdAt: at(message.minutesAgo),
          })),
        },
      },
    });

    created++;
  }

  const hasNotifications = await prisma.notification.count({ where: { userId: buyer.id } });

  if (!hasNotifications) {
    await prisma.notification.createMany({
      data: [
        {
          userId: buyer.id,
          type: NotificationType.WISHLIST_PRICE_DROP,
          category: NotificationCategory.PRICE_ALERTS,
          title: "Price drop on a saved listing",
          body: "A bike you saved is now cheaper. Take a look before it's gone.",
          link: "/buyer-dashboard/saved",
        },
        {
          userId: buyer.id,
          type: NotificationType.SYSTEM,
          category: NotificationCategory.ACCOUNT,
          title: `Welcome to ${config.app_name}`,
          body: "Message sellers, save listings and get alerts when prices drop.",
          link: "/listings",
          readAt: new Date(),
        },
      ],
    });
  }

  console.log(`Demo conversations created: ${created} (others already existed)`);
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
    await seedSampleListings();
    await seedDemoConversations();

    console.log("Demo seeding completed successfully.");
  } catch (error) {
    console.error("Error running demo seed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

runSeed();
