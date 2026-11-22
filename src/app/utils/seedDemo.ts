/*
 * Demo data seed. Run with: npm run seed
 * Idempotent: every step checks before inserting, like seed.ts.
 *
 * Steps are filled in as their modules are built:
 *   Phase 1 → seedDemoUsers, seedVehicleTypes, seedBrandsAndModels, seedSampleListings,
 *             seedDemoConversations, seedDemoTrust, seedModerationHistory,
 *             seedVerificationRequests, seedDemoEngagement, seedDemoReviews, seedDemoReports
 *   Phase 2 → seedDemoOffers, seedDemoTestRides, seedDemoSavedSearches, seedPlans, seedCmsPages
 *   Phase 3 → seedGroups, seedBadges
 */
import bcrypt from "bcrypt";
import { Prisma } from "../../generated/prisma/client";
import {
  AuditAction,
  AuthProvider,
  DocumentKind,
  ListingStatus,
  MessageType,
  NotificationCategory,
  NotificationType,
  OfferStatus,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  Role,
  SavedSearchAlertFrequency,
  SavedSearchMatchKind,
  TestRideStatus,
  UserStatus,
  VerificationStatus,
  VerificationType,
} from "../../generated/prisma/enums";
import { config } from "../config";
import { validateSpecs } from "../helper/buildDynamicSpecSchema";
import { findDistrict } from "../helper/bdLocations";
import { generateSlug } from "../helper/generateSlug";
import { prisma } from "../lib/prisma";
import { syncSearch } from "../module/listing/listing.service";
import { recalculateSellerRating } from "../module/review/review.utils";
import {
  buildSavedSearchName,
  canonicalizeSearchQuery,
  describeSearchQuery,
  hashSearchQuery,
} from "../module/savedSearch/savedSearch.utils";
import {
  listingMatchesFilters,
  resolveSearchFilters,
} from "../module/search/search.service";
import { generateListingSlug } from "../module/listing/listing.utils";
import {
  offerExpiryDate,
  offerNoticeText,
  offerPreview,
} from "../module/offer/offer.utils";
import {
  testRideNoticeText,
  testRidePreview,
} from "../module/testRide/testRide.utils";
import {
  dayOfWeekOf,
  localTimeToUtc,
  shiftDateKey,
  toLocalDateKey,
} from "../helper/timeZone";
import { parseAttributes } from "../module/vehicleType/vehicleType.utils";
import { VehicleAttributesZodSchema } from "../module/vehicleType/vehicleType.validation";
import { seedSuperAdmin } from "./seed";
import {
  BIKE_ATTRIBUTES,
  BIKE_BRANDS,
  BIKE_VEHICLE_TYPE,
} from "./seedData/bikeCatalog";
import { createSampleDocumentPng } from "./seedData/sampleDocument";
import {
  MARKET_LISTINGS,
  SAMPLE_LISTINGS,
  WORKFLOW_LISTINGS,
} from "./seedData/sampleListings";
import { uploadToCloudinary } from "./uploadToCloudinary";

// ============================================
// Demo Users (one per role + extra accounts for testing)
// ============================================

type TDemoUser = {
  name: string;
  email: string;
  role: Role;
  status?: UserStatus;
  // soft-deleted account (user management "deleted" filter, restore)
  isDeleted?: boolean;
};

const DEMO_USERS: TDemoUser[] = [
  { name: "Demo Admin", email: "admin@ridex.demo", role: Role.ADMIN },
  {
    name: "Demo Moderator",
    email: "moderator@ridex.demo",
    role: Role.MODERATOR,
  },
  { name: "Demo Dealer", email: "dealer@ridex.demo", role: Role.DEALER },
  {
    name: "Demo Dealer Staff",
    email: "dealer.staff@ridex.demo",
    role: Role.DEALER_STAFF,
  },
  { name: "Demo Seller", email: "seller@ridex.demo", role: Role.SELLER },
  {
    name: "Demo Inspector",
    email: "inspector@ridex.demo",
    role: Role.INSPECTOR,
  },
  { name: "Demo Buyer", email: "buyer@ridex.demo", role: Role.BUYER },
  // second buyer: pending ID verification, a hidden review, a block
  { name: "Demo Buyer Two", email: "buyer2@ridex.demo", role: Role.BUYER },
  // unverified dealer with a pending dealer verification request
  { name: "Demo Dealer Two", email: "dealer2@ridex.demo", role: Role.DEALER },
  {
    name: "Blocked Rider",
    email: "blocked@ridex.demo",
    role: Role.BUYER,
    status: UserStatus.BLOCKED,
  },
  {
    name: "Deleted Rider",
    email: "deleted@ridex.demo",
    role: Role.BUYER,
    status: UserStatus.INACTIVE,
    isDeleted: true,
  },
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
        status: demoUser.status ?? UserStatus.ACTIVE,
        emailVerified: true,
        ...(demoUser.isDeleted && { isDeleted: true, deletedAt: new Date() }),
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

  console.log(
    `Vehicle type created: ${vehicleType.name} (${attributes.length} attributes)`,
  );

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
        brandId_vehicleTypeId: {
          brandId: brand.id,
          vehicleTypeId: bikeType.id,
        },
      },
      create: { brandId: brand.id, vehicleTypeId: bikeType.id },
      update: {},
    });

    for (const seedModel of seedBrand.models) {
      const existingModel = await prisma.vehicleModel.findUnique({
        where: { brandId_name: { brandId: brand.id, name: seedModel.name } },
      });

      if (existingModel) continue;

      const specs = validateSpecs(attributes, seedModel.specs, {
        partial: true,
      });

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

const DAY_MS = 24 * 60 * 60 * 1000;

// negative values are in the future
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

/*
 * Demo listings by the demo seller and dealer: the approved catalogue plus
 * one or more listings in every status (WORKFLOW_LISTINGS), plus market
 * listings that give price insight enough comparables (MARKET_LISTINGS).
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
  const expiresAt = new Date(
    Date.now() + config.listing_duration_days * 24 * 60 * 60 * 1000,
  );
  let created = 0;

  const moderator = await prisma.user.findUnique({
    where: { email: "moderator@ridex.demo" },
  });

  for (const [index, sample] of [
    ...SAMPLE_LISTINGS,
    ...WORKFLOW_LISTINGS,
    // comparables for price insight (Phase 2 · Part 2a)
    ...MARKET_LISTINGS,
  ].entries()) {
    const brand = await prisma.brand.findUnique({
      where: { slug: sample.brand },
    });
    const model = brand
      ? await prisma.vehicleModel.findUnique({
          where: { brandId_slug: { brandId: brand.id, slug: sample.model } },
        })
      : null;

    if (!brand || !model) {
      console.log(
        `Skipping sample listing: ${sample.brand}/${sample.model} not found`,
      );
      continue;
    }

    const sellerId = sample.seller === "dealer" ? dealer.id : seller.id;

    const alreadySeeded = await prisma.listing.findFirst({
      where: {
        sellerId,
        vehicleModelId: model.id,
        year: sample.year,
        price: sample.price,
      },
      select: { id: true },
    });

    if (alreadySeeded) continue;

    const specs = validateSpecs(attributes, model.defaultSpecs);

    if (!specs.success) {
      throw new Error(
        `Sample listing ${model.name} has invalid specs: ${specs.message}`,
      );
    }

    const centre = findDistrict(sample.division, sample.district);

    if (!centre) {
      throw new Error(`Sample listing ${model.name} has an invalid location`);
    }

    const status = sample.status ?? ListingStatus.APPROVED;
    // spread dates over the last few weeks for realistic "newest" sorting
    const happenedAt =
      sample.daysAgo === undefined
        ? new Date(Date.now() - index * 26 * 60 * 60 * 1000)
        : daysAgo(sample.daysAgo);
    const wasApproved =
      status === ListingStatus.APPROVED || status === ListingStatus.SOLD;

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
        status,
        submittedAt: status === ListingStatus.DRAFT ? null : happenedAt,
        // a sold bike was approved a few days before it sold
        approvedAt: wasApproved
          ? status === ListingStatus.SOLD
            ? new Date(happenedAt.getTime() - 3 * DAY_MS)
            : happenedAt
          : null,
        approvedById: wasApproved ? (moderator?.id ?? null) : null,
        rejectionReason: sample.rejectionReason ?? null,
        soldAt: status === ListingStatus.SOLD ? happenedAt : null,
        expiresAt: wasApproved
          ? sample.expiresInDays === undefined
            ? expiresAt
            : daysAgo(-sample.expiresInDays)
          : null,
        viewsCount: wasApproved ? (index * 37) % 400 : 0,
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

type TSeedMessage = {
  from: "buyer" | "seller";
  body: string;
  minutesAgo: number;
};

const DEMO_THREADS: {
  sellerEmail: string;
  listingIndex: number;
  messages: TSeedMessage[];
}[] = [
  {
    sellerEmail: "seller@ridex.demo",
    listingIndex: 0,
    messages: [
      { from: "buyer", body: "Hi, is this still available?", minutesAgo: 180 },
      { from: "seller", body: "Yes, it's still available.", minutesAgo: 170 },
      {
        from: "buyer",
        body: "Are all the papers up to date? Can I see it this weekend?",
        minutesAgo: 160,
      },
      {
        from: "seller",
        body: "All papers are clear. Saturday afternoon works, I'm in Mirpur.",
        minutesAgo: 20,
      },
    ],
  },
  {
    sellerEmail: "dealer@ridex.demo",
    listingIndex: 0,
    messages: [
      { from: "buyer", body: "Can I take a test ride?", minutesAgo: 60 * 26 },
      {
        from: "seller",
        body: "You're welcome to come and see it. Our showroom is open 10am to 8pm.",
        minutesAgo: 60 * 25,
      },
    ],
  },
];

export const seedDemoConversations = async () => {
  const buyer = await prisma.user.findUnique({
    where: { email: "buyer@ridex.demo" },
  });

  if (!buyer) {
    console.log("Demo buyer missing. Skipping demo conversations.");
    return;
  }

  let created = 0;

  for (const thread of DEMO_THREADS) {
    const seller = await prisma.user.findUnique({
      where: { email: thread.sellerEmail },
    });
    if (!seller) continue;

    const listing = (
      await prisma.listing.findMany({
        where: {
          sellerId: seller.id,
          status: ListingStatus.APPROVED,
          isDeleted: false,
        },
        orderBy: { createdAt: "asc" },
        take: thread.listingIndex + 1,
        select: { id: true },
      })
    )[thread.listingIndex];

    if (!listing) continue;

    const exists = await prisma.conversation.findUnique({
      where: {
        listingId_buyerId: { listingId: listing.id, buyerId: buyer.id },
      },
    });

    if (exists) continue;

    const at = (minutesAgo: number) =>
      new Date(Date.now() - minutesAgo * 60 * 1000);
    const last = thread.messages[thread.messages.length - 1];
    // the buyer has read up to their own last message; newer seller replies stay unread
    const lastBuyerMessage = [...thread.messages]
      .reverse()
      .find((message) => message.from === "buyer");
    const buyerUnread = thread.messages.filter(
      (message) =>
        message.from === "seller" &&
        message.minutesAgo < (lastBuyerMessage?.minutesAgo ?? Infinity),
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
        buyerLastReadAt: lastBuyerMessage
          ? at(lastBuyerMessage.minutesAgo)
          : null,
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

  const hasNotifications = await prisma.notification.count({
    where: { userId: buyer.id },
  });

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

  console.log(
    `Demo conversations created: ${created} (others already existed)`,
  );
};

// ============================================
// Demo activity (Phase 1 test data)
// ============================================

/*
 * Everything below makes each Phase 1 screen testable right after `npm run seed`:
 * trust badges, moderation history, verification queue, saved / recently viewed,
 * reviews, reports, blocks and quick replies. Every step checks before inserting.
 */

type TDemoUsers = Record<
  | "admin"
  | "moderator"
  | "seller"
  | "dealer"
  | "buyer"
  | "buyer2"
  | "dealer2"
  | "blocked",
  { id: string; name: string }
>;

const DEMO_EMAILS = {
  admin: "admin@ridex.demo",
  moderator: "moderator@ridex.demo",
  seller: "seller@ridex.demo",
  dealer: "dealer@ridex.demo",
  buyer: "buyer@ridex.demo",
  buyer2: "buyer2@ridex.demo",
  dealer2: "dealer2@ridex.demo",
  blocked: "blocked@ridex.demo",
} as const;

const loadDemoUsers = async (): Promise<TDemoUsers | null> => {
  const users = await prisma.user.findMany({
    where: { email: { in: Object.values(DEMO_EMAILS) } },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(users.map((user) => [user.email, user]));

  const entries = Object.entries(DEMO_EMAILS).map(([key, email]) => [
    key,
    byEmail.get(email),
  ]);

  if (entries.some(([, user]) => !user)) return null;

  return Object.fromEntries(entries) as TDemoUsers;
};

// approved, live listings of one seller, oldest first (stable across runs)
const liveListingsOf = (sellerId: string) =>
  prisma.listing.findMany({
    where: { sellerId, status: ListingStatus.APPROVED, isDeleted: false },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });

/*
 * Verified badges: the seller has phone + ID, the dealer has phone + dealer.
 * Each badge gets an APPROVED request (documents already purged), like a real approval.
 */
export const seedDemoTrust = async (users: TDemoUsers) => {
  const badges = [
    {
      user: users.seller,
      phone: "+8801700000001",
      type: VerificationType.ID,
      details: { fullName: users.seller.name, nidLast4: "4321" },
      field: "idVerifiedAt" as const,
    },
    {
      user: users.dealer,
      phone: "+8801700000002",
      type: VerificationType.DEALER,
      details: {
        businessName: "Demo Motors",
        tradeLicenseNumber: "TRAD/DNCC/012345/2024",
        division: "Dhaka",
        district: "Dhaka",
        area: "Tejgaon",
      },
      field: "dealerVerifiedAt" as const,
    },
  ];

  let created = 0;

  for (const badge of badges) {
    const exists = await prisma.verificationRequest.findFirst({
      where: { userId: badge.user.id, type: badge.type },
      select: { id: true },
    });

    if (exists) continue;

    created += 1;
    const reviewedAt = daysAgo(20);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: badge.user.id },
        data: {
          phone: badge.phone,
          phoneVerified: true,
          [badge.field]: reviewedAt,
        },
      });

      const request = await tx.verificationRequest.create({
        data: {
          userId: badge.user.id,
          type: badge.type,
          status: VerificationStatus.APPROVED,
          details: badge.details as Prisma.InputJsonValue,
          reviewedById: users.admin.id,
          reviewedAt,
          documentsPurgedAt: reviewedAt,
          createdAt: daysAgo(21),
        },
      });

      await tx.auditLog.create({
        data: {
          userId: users.admin.id,
          action: AuditAction.APPROVE,
          entity: "VerificationRequest",
          entityId: request.id,
          oldData: { status: VerificationStatus.PENDING },
          newData: { status: VerificationStatus.APPROVED, type: badge.type },
          createdAt: reviewedAt,
        },
      });
    });
  }

  console.log(
    `Demo trust badges created: ${created} (seller: phone + ID, dealer: phone + dealer)`,
  );
};

/*
 * Audit entries for the seeded approvals and rejection, so the moderator
 * dashboard and the audit log have history (decision counts come from the audit log).
 */
export const seedModerationHistory = async (users: TDemoUsers) => {
  const hasHistory = await prisma.auditLog.count({
    where: { userId: users.moderator.id, entity: "Listing" },
  });

  if (hasHistory) {
    console.log("Moderation history already exists!");
    return;
  }

  const decided = await prisma.listing.findMany({
    where: {
      sellerId: { in: [users.seller.id, users.dealer.id] },
      status: {
        in: [
          ListingStatus.APPROVED,
          ListingStatus.SOLD,
          ListingStatus.REJECTED,
        ],
      },
    },
    select: {
      id: true,
      status: true,
      approvedAt: true,
      submittedAt: true,
      rejectionReason: true,
    },
  });

  // two batched writes (the remote dev DB is too slow for a per-row transaction)
  await prisma.$transaction([
    prisma.listing.updateMany({
      where: { id: { in: decided.map((listing) => listing.id) } },
      data: { approvedById: users.moderator.id },
    }),
    prisma.auditLog.createMany({
      data: decided.map((listing) => {
        const isReject = listing.status === ListingStatus.REJECTED;

        return {
          userId: users.moderator.id,
          action: isReject ? AuditAction.REJECT : AuditAction.APPROVE,
          entity: "Listing",
          entityId: listing.id,
          oldData: { status: ListingStatus.PENDING },
          newData: {
            status: isReject ? ListingStatus.REJECTED : ListingStatus.APPROVED,
            reason: listing.rejectionReason ?? null,
          },
          createdAt: listing.approvedAt ?? listing.submittedAt ?? new Date(),
        };
      }),
    }),
  ]);

  console.log(`Moderation history created for ${decided.length} listing(s).`);
};

const DOCUMENT_SETS: Record<VerificationType, DocumentKind[]> = {
  [VerificationType.ID]: [
    DocumentKind.NID_FRONT,
    DocumentKind.NID_BACK,
    DocumentKind.SELFIE,
  ],
  [VerificationType.DEALER]: [DocumentKind.TRADE_LICENSE],
};

/*
 * Two PENDING requests for the admin verification queue.
 * Documents are generated placeholder PNGs uploaded privately to Cloudinary;
 * the step is skipped when Cloudinary is not configured.
 */
export const seedVerificationRequests = async (users: TDemoUsers) => {
  if (!config.cloudinary_cloud_name || !config.cloudinary_api_key) {
    console.log(
      "Cloudinary not configured. Skipping pending verification requests.",
    );
    return;
  }

  const pending = [
    {
      user: users.buyer2,
      type: VerificationType.ID,
      details: { fullName: users.buyer2.name, nidLast4: "8765" },
    },
    {
      user: users.dealer2,
      type: VerificationType.DEALER,
      details: {
        businessName: "Second Gear Bikes",
        tradeLicenseNumber: "TRAD/CCC/067890/2025",
        division: "Chattogram",
        district: "Chattogram",
        area: "Agrabad",
      },
    },
  ];

  let created = 0;

  for (const item of pending) {
    const exists = await prisma.verificationRequest.findFirst({
      where: { userId: item.user.id, type: item.type },
      select: { id: true },
    });

    if (exists) continue;

    const kinds = DOCUMENT_SETS[item.type];
    const uploaded = await Promise.all(
      kinds.map((kind) =>
        uploadToCloudinary(
          {
            buffer: createSampleDocumentPng(kind),
            mimetype: "image/png",
            originalname: `${kind.toLowerCase()}-sample.png`,
            size: 0,
          } as Express.Multer.File,
          {
            type: "private",
            folder: `${config.app_name.toLowerCase()}/verification/${item.user.id}`,
          },
        ),
      ),
    );

    await prisma.verificationRequest.create({
      data: {
        userId: item.user.id,
        type: item.type,
        details: item.details as Prisma.InputJsonValue,
        createdAt: daysAgo(1),
        documents: {
          create: uploaded.map((file, index) => ({
            kind: kinds[index],
            publicId: file.public_id,
            resourceType: file.resource_type,
            format: file.format,
            bytes: file.bytes,
          })),
        },
      },
    });

    created += 1;
  }

  console.log(`Pending verification requests created: ${created}`);
};

/*
 * Saved bikes (one already sold), recently viewed, a block and seller quick replies.
 */
export const seedDemoEngagement = async (users: TDemoUsers) => {
  const [sellerListings, dealerListings, soldListing] = await Promise.all([
    liveListingsOf(users.seller.id),
    liveListingsOf(users.dealer.id),
    prisma.listing.findFirst({
      where: { sellerId: users.seller.id, status: ListingStatus.SOLD },
      select: { id: true },
    }),
  ]);

  const saves = [
    ...[sellerListings[1], sellerListings[3], dealerListings[0]].map(
      (listing) => ({
        userId: users.buyer.id,
        listingId: listing?.id,
      }),
    ),
    { userId: users.buyer.id, listingId: soldListing?.id },
    { userId: users.buyer2.id, listingId: sellerListings[0]?.id },
    { userId: users.buyer2.id, listingId: dealerListings[1]?.id },
  ].filter((item): item is { userId: string; listingId: string } =>
    Boolean(item.listingId),
  );

  const saved = await prisma.wishlistItem.createMany({
    data: saves,
    skipDuplicates: true,
  });

  const viewed = [...sellerListings.slice(0, 4), ...dealerListings.slice(0, 2)];

  for (const [index, listing] of viewed.entries()) {
    await prisma.recentlyViewed.upsert({
      where: {
        userId_listingId: { userId: users.buyer.id, listingId: listing.id },
      },
      update: {},
      create: {
        userId: users.buyer.id,
        listingId: listing.id,
        viewedAt: new Date(Date.now() - (index + 1) * 3 * 60 * 60 * 1000),
      },
    });
  }

  await prisma.userBlock.createMany({
    data: [{ blockerId: users.buyer2.id, blockedId: users.blocked.id }],
    skipDuplicates: true,
  });

  const hasQuickReplies = await prisma.quickReply.count({
    where: { userId: users.seller.id },
  });

  if (!hasQuickReplies) {
    await prisma.quickReply.createMany({
      data: [
        "Yes, it's still available.",
        "The price is slightly negotiable for a quick buyer.",
        "You can see the bike in Mirpur on any weekend afternoon.",
      ].map((text, index) => ({
        userId: users.seller.id,
        text,
        sortOrder: index,
      })),
    });
  }

  console.log(
    `Saved bikes added: ${saved.count}, recently viewed: ${viewed.length}, block + quick replies ready.`,
  );
};

/*
 * Three reviews: a 5-star one with a seller reply, a 4-star one for the dealer,
 * and a 1-star one hidden by the moderator (does not count toward the rating).
 */
export const seedDemoReviews = async (users: TDemoUsers) => {
  const [sellerListings, dealerListings] = await Promise.all([
    liveListingsOf(users.seller.id),
    liveListingsOf(users.dealer.id),
  ]);

  const reviews = [
    {
      reviewer: users.buyer,
      seller: users.seller,
      listing: sellerListings[0],
      rating: 5,
      comment:
        "Honest seller. The bike was exactly as described and the papers were ready.",
      sellerReply: "Thanks for buying! Enjoy the ride.",
    },
    {
      reviewer: users.buyer,
      seller: users.dealer,
      listing: dealerListings[0],
      rating: 4,
      comment:
        "Good showroom and a smooth test ride. Paperwork took a little long.",
    },
    {
      reviewer: users.buyer2,
      seller: users.seller,
      listing: sellerListings[2],
      rating: 1,
      comment: "Total scam, call me on WhatsApp for a better deal!!!",
      hiddenReason: "Spam / off-platform contact",
    },
  ];

  let created = 0;

  for (const review of reviews) {
    if (!review.listing) continue;

    const exists = await prisma.review.findUnique({
      where: {
        reviewerId_listingId: {
          reviewerId: review.reviewer.id,
          listingId: review.listing.id,
        },
      },
      select: { id: true },
    });

    if (exists) continue;

    await prisma.$transaction(async (tx) => {
      await tx.review.create({
        data: {
          reviewerId: review.reviewer.id,
          sellerId: review.seller.id,
          listingId: review.listing.id,
          rating: review.rating,
          comment: review.comment,
          sellerReply: review.sellerReply ?? null,
          sellerRepliedAt: review.sellerReply ? daysAgo(2) : null,
          isHidden: Boolean(review.hiddenReason),
          hiddenReason: review.hiddenReason ?? null,
          createdAt: daysAgo(3),
        },
      });

      await recalculateSellerRating(tx, review.seller.id);
    });

    created += 1;
  }

  console.log(`Demo reviews created: ${created}`);
};

/*
 * Moderator queue: open reports on a listing, a user and a message, one in review,
 * plus a resolved and a dismissed report for the history filters.
 */
export const seedDemoReports = async (users: TDemoUsers) => {
  const [sellerListings, dealerListings, sellerMessage, hiddenReview] =
    await Promise.all([
      liveListingsOf(users.seller.id),
      liveListingsOf(users.dealer.id),
      prisma.message.findFirst({
        where: { senderId: users.seller.id },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      }),
      prisma.review.findFirst({
        where: { reviewerId: users.buyer2.id, isHidden: true },
        select: { id: true },
      }),
    ]);

  const reports: Prisma.ReportCreateManyInput[] = [
    {
      reporterId: users.buyer.id,
      targetType: ReportTargetType.LISTING,
      listingId: sellerListings[4]?.id,
      reason: ReportReason.WRONG_INFO,
      details: "The listing says 2021 but the tax token shows 2019.",
      createdAt: daysAgo(1),
    },
    {
      reporterId: users.buyer2.id,
      targetType: ReportTargetType.USER,
      reportedUserId: users.blocked.id,
      reason: ReportReason.HARASSMENT,
      details: "Kept messaging me after I said no.",
      status: ReportStatus.IN_REVIEW,
      createdAt: daysAgo(2),
    },
    ...(sellerMessage
      ? [
          {
            reporterId: users.buyer2.id,
            targetType: ReportTargetType.MESSAGE,
            messageId: sellerMessage.id,
            reason: ReportReason.SPAM,
            details: "Test report on a chat message.",
            createdAt: daysAgo(0),
          },
        ]
      : []),
    ...(hiddenReview
      ? [
          {
            reporterId: users.buyer.id,
            targetType: ReportTargetType.REVIEW,
            reviewId: hiddenReview.id,
            reason: ReportReason.SPAM,
            status: ReportStatus.RESOLVED,
            actionTaken: "HIDE_REVIEW",
            resolutionNote: "Review hidden: off-platform contact.",
            resolvedById: users.moderator.id,
            resolvedAt: daysAgo(2),
            createdAt: daysAgo(3),
          },
        ]
      : []),
    {
      reporterId: users.buyer.id,
      targetType: ReportTargetType.LISTING,
      listingId: dealerListings[2]?.id,
      reason: ReportReason.DUPLICATE,
      details: "I think I saw this bike twice.",
      status: ReportStatus.DISMISSED,
      resolutionNote: "Different bikes of the same model. No action needed.",
      resolvedById: users.moderator.id,
      resolvedAt: daysAgo(5),
      createdAt: daysAgo(6),
    },
  ];

  let created = 0;

  // idempotent per report: same reporter, target, reason and details
  for (const report of reports) {
    const exists = await prisma.report.findFirst({
      where: {
        reporterId: report.reporterId,
        targetType: report.targetType,
        reason: report.reason,
        details: report.details ?? null,
        listingId: report.listingId ?? null,
        reportedUserId: report.reportedUserId ?? null,
        reviewId: report.reviewId ?? null,
        messageId: report.messageId ?? null,
      },
      select: { id: true },
    });

    if (exists) continue;

    await prisma.report.create({ data: report });
    created += 1;
  }

  console.log(`Demo reports created: ${created}`);
};

// ============================================
// Offers (Phase 2 · Part 1)
// ============================================

type TSeedOfferStep = {
  from: "buyer" | "seller";
  // share of the asking price
  percent: number;
  message?: string;
  hoursAgo: number;
};

/*
 * One negotiation inside the buyer's thread for a listing: every step is an
 * OFFER card; all but the last are COUNTERED. The last step ends as
 * `finalStatus` (ACCEPTED adds the SYSTEM notice the service would post).
 */
const seedOfferThread = async (input: {
  listing: { id: string; price: Prisma.Decimal; sellerId: string };
  buyerId: string;
  steps: TSeedOfferStep[];
  finalStatus: OfferStatus;
}) => {
  const { listing, buyerId } = input;
  const at = (hoursAgo: number) =>
    new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const firstAt = at(input.steps[0].hoursAgo);

  const existing = await prisma.conversation.findUnique({
    where: { listingId_buyerId: { listingId: listing.id, buyerId } },
  });

  const conversation =
    existing ??
    (await prisma.conversation.create({
      data: {
        listingId: listing.id,
        buyerId,
        sellerId: listing.sellerId,
        createdAt: firstAt,
      },
    }));

  const price = Number(listing.price);
  let parentOfferId: string | null = null;
  let lastAt = firstAt;
  let lastPreview = "";
  let lastSenderId: string | null = null;

  for (const [index, step] of input.steps.entries()) {
    const isLast = index === input.steps.length - 1;
    const proposedById = step.from === "buyer" ? buyerId : listing.sellerId;
    const amount = Math.round((price * step.percent) / 100 / 500) * 500;
    const createdAt = at(step.hoursAgo);

    const offer: { id: string } = await prisma.offer.create({
      data: {
        listingId: listing.id,
        conversationId: conversation.id,
        buyerId,
        sellerId: listing.sellerId,
        proposedById,
        amount,
        message: step.message ?? "",
        status: isLast ? input.finalStatus : OfferStatus.COUNTERED,
        parentOfferId,
        round: index + 1,
        expiresAt: offerExpiryDate(config.offer_expiry_hours, createdAt),
        respondedAt:
          isLast && input.finalStatus === OfferStatus.PENDING
            ? null
            : at(Math.max(step.hoursAgo - 1, 0)),
        createdAt,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: proposedById,
        type: MessageType.OFFER,
        body: step.message ?? "",
        offerId: offer.id,
        createdAt,
      },
    });

    parentOfferId = offer.id;
    lastAt = createdAt;
    lastPreview = offerPreview(amount);
    lastSenderId = proposedById;

    if (isLast && input.finalStatus === OfferStatus.ACCEPTED) {
      const noticeAt = at(Math.max(step.hoursAgo - 1, 0));
      const body = offerNoticeText("accepted", amount);

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: null,
          type: MessageType.SYSTEM,
          body,
          offerId: offer.id,
          createdAt: noticeAt,
        },
      });

      lastAt = noticeAt;
      lastPreview = body.slice(0, 120);
      lastSenderId = null;
    }
  }

  // an open offer is unread for the side that has to answer it
  const waitingSide =
    input.finalStatus === OfferStatus.PENDING
      ? lastSenderId === buyerId
        ? "seller"
        : "buyer"
      : null;

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: lastAt,
      lastMessagePreview: lastPreview,
      lastMessageSenderId: lastSenderId,
      // a new thread starts fully read; an existing one keeps its read markers
      ...(!existing && {
        buyerLastReadAt: waitingSide === "buyer" ? firstAt : lastAt,
        sellerLastReadAt: waitingSide === "seller" ? firstAt : lastAt,
      }),
      ...(waitingSide === "seller" && { sellerUnreadCount: { increment: 1 } }),
      ...(waitingSide === "buyer" && { buyerUnreadCount: { increment: 1 } }),
    },
  });
};

/*
 * Three negotiations, each in a state the UI must handle:
 *   buyer  ↔ seller  open offer waiting for the seller
 *   buyer2 ↔ dealer  buyer offered, dealer countered (waiting for the buyer);
 *                    a seller listing when the dealer has no negotiable one
 *   buyer2 ↔ seller  accepted after one counter
 */
export const seedDemoOffers = async (users: TDemoUsers) => {
  const negotiableOf = (sellerId: string) =>
    prisma.listing.findMany({
      where: {
        sellerId,
        status: ListingStatus.APPROVED,
        isDeleted: false,
        isNegotiable: true,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, price: true, sellerId: true },
    });

  const [sellerListings, dealerListings] = await Promise.all([
    negotiableOf(users.seller.id),
    negotiableOf(users.dealer.id),
  ]);

  const plans = [
    {
      listing: sellerListings[0],
      buyerId: users.buyer.id,
      finalStatus: OfferStatus.PENDING,
      steps: [
        {
          from: "buyer" as const,
          percent: 90,
          message: "I can pay cash this weekend.",
          hoursAgo: 6,
        },
      ],
    },
    {
      // the demo dealer sells at fixed prices; fall back to a seller listing
      listing: dealerListings[0] ?? sellerListings[2],
      buyerId: users.buyer2.id,
      finalStatus: OfferStatus.PENDING,
      steps: [
        { from: "buyer" as const, percent: 85, hoursAgo: 20 },
        {
          from: "seller" as const,
          percent: 95,
          message: "Includes a free first service.",
          hoursAgo: 4,
        },
      ],
    },
    {
      listing: sellerListings[1],
      buyerId: users.buyer2.id,
      finalStatus: OfferStatus.ACCEPTED,
      steps: [
        { from: "buyer" as const, percent: 88, hoursAgo: 30 },
        { from: "seller" as const, percent: 94, hoursAgo: 28 },
      ],
    },
  ];

  let created = 0;

  for (const plan of plans) {
    if (!plan.listing) continue;

    const exists = await prisma.offer.count({
      where: { listingId: plan.listing.id, buyerId: plan.buyerId },
    });

    if (exists) continue;

    await seedOfferThread({
      listing: plan.listing,
      buyerId: plan.buyerId,
      steps: plan.steps,
      finalStatus: plan.finalStatus,
    });
    created++;
  }

  console.log(
    `Demo offer negotiations created: ${created} (others already existed)`,
  );
};

// ============================================
// Test rides (Phase 2 · Part 1)
// ============================================

// Bangladesh weekend is Friday: Saturday (6) to Thursday (4)
const WORK_DAYS = [6, 0, 1, 2, 3, 4];

/*
 * Weekly hours for the seller (10:00–18:00, one ride at a time) and the
 * dealer (10:00–20:00, two at once), then two bookings:
 *   buyer  ↔ seller  REQUESTED, waiting for the seller
 *   buyer2 ↔ dealer  CONFIRMED with a meeting note
 * Times are the next working days after today, so they are always upcoming.
 */
export const seedDemoTestRides = async (users: TDemoUsers) => {
  const hours = [
    { sellerId: users.seller.id, endTime: "18:00", capacity: 1 },
    { sellerId: users.dealer.id, endTime: "20:00", capacity: 2 },
  ];

  for (const plan of hours) {
    const exists = await prisma.testRideAvailability.count({
      where: { sellerId: plan.sellerId },
    });

    if (exists) continue;

    await prisma.testRideAvailability.createMany({
      data: WORK_DAYS.map((dayOfWeek) => ({
        sellerId: plan.sellerId,
        dayOfWeek,
        startTime: "10:00",
        endTime: plan.endTime,
        slotMinutes: 30,
        capacity: plan.capacity,
      })),
    });
  }

  const exists = await prisma.testRide.count({
    where: { buyerId: { in: [users.buyer.id, users.buyer2.id] } },
  });

  if (exists) {
    console.log("Demo test rides already exist!");
    return;
  }

  // the n-th working day after today, at a local time
  const workingDayAt = (nth: number, time: string) => {
    let dateKey = toLocalDateKey(new Date());
    let found = 0;

    while (found < nth) {
      dateKey = shiftDateKey(dateKey, 1);
      if (WORK_DAYS.includes(dayOfWeekOf(dateKey))) found++;
    }

    return localTimeToUtc(dateKey, time);
  };

  const [sellerListing] = await liveListingsOf(users.seller.id);
  const [dealerListing] = await liveListingsOf(users.dealer.id);

  const bookings = [
    {
      listing: sellerListing,
      sellerId: users.seller.id,
      buyerId: users.buyer.id,
      startsAt: workingDayAt(1, "11:00"),
      status: TestRideStatus.REQUESTED,
      buyerNote: "I'd like to check the brakes and the gearbox.",
      sellerNote: "",
    },
    {
      listing: dealerListing,
      sellerId: users.dealer.id,
      buyerId: users.buyer2.id,
      startsAt: workingDayAt(2, "16:30"),
      status: TestRideStatus.CONFIRMED,
      buyerNote: "",
      sellerNote: "Ask for Rafiq at the front desk. Bring your licence.",
    },
  ];

  let created = 0;

  for (const booking of bookings) {
    if (!booking.listing) continue;

    const conversation =
      (await prisma.conversation.findUnique({
        where: {
          listingId_buyerId: {
            listingId: booking.listing.id,
            buyerId: booking.buyerId,
          },
        },
      })) ??
      (await prisma.conversation.create({
        data: {
          listingId: booking.listing.id,
          buyerId: booking.buyerId,
          sellerId: booking.sellerId,
        },
      }));

    const requestedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const ride = await prisma.testRide.create({
      data: {
        listingId: booking.listing.id,
        conversationId: conversation.id,
        buyerId: booking.buyerId,
        sellerId: booking.sellerId,
        startsAt: booking.startsAt,
        endsAt: new Date(booking.startsAt.getTime() + 30 * 60 * 1000),
        status: booking.status,
        buyerNote: booking.buyerNote,
        sellerNote: booking.sellerNote,
        confirmedAt:
          booking.status === TestRideStatus.CONFIRMED ? new Date() : null,
        createdAt: requestedAt,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: booking.buyerId,
        type: MessageType.TEST_RIDE,
        body: booking.buyerNote,
        testRideId: ride.id,
        createdAt: requestedAt,
      },
    });

    let lastAt = requestedAt;
    let preview = testRidePreview(booking.startsAt);
    let lastSenderId: string | null = booking.buyerId;

    if (booking.status === TestRideStatus.CONFIRMED) {
      lastAt = new Date();
      preview = testRideNoticeText(
        "confirmed",
        booking.startsAt,
        booking.sellerNote,
      ).slice(0, 120);
      lastSenderId = null;

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: null,
          type: MessageType.SYSTEM,
          body: testRideNoticeText(
            "confirmed",
            booking.startsAt,
            booking.sellerNote,
          ),
          testRideId: ride.id,
          createdAt: lastAt,
        },
      });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: lastAt,
        lastMessagePreview: preview,
        lastMessageSenderId: lastSenderId,
        // a request waits for the seller; a confirmation is news for the buyer
        ...(booking.status === TestRideStatus.REQUESTED
          ? { sellerUnreadCount: { increment: 1 } }
          : { buyerUnreadCount: { increment: 1 } }),
      },
    });

    created++;
  }

  console.log(`Demo test rides created: ${created}`);
};

/*
 * Prints every demo login (password from DEMO_USER_PASSWORD, never printed).
 */
const printDemoCredentials = () => {
  console.table([
    {
      role: "SUPER_ADMIN",
      email: config.super_admin_email,
      password: "SUPER_ADMIN_PASSWORD",
    },
    ...DEMO_USERS.map((user) => ({
      role: user.role,
      email: user.email,
      password: "DEMO_USER_PASSWORD",
      note: user.isDeleted
        ? "soft-deleted (cannot log in)"
        : user.status === UserStatus.BLOCKED
          ? "blocked (cannot log in)"
          : "",
    })),
  ]);
};

// ============================================
// Demo Saved Searches (Phase 2 · Part 2b)
// ============================================

type TDemoSavedSearch = {
  user: "buyer" | "buyer2";
  query: Record<string, string>;
  alertFrequency: SavedSearchAlertFrequency;
  // matches already announced (instant) or still waiting (daily digest)
  pending: boolean;
};

const DEMO_SAVED_SEARCHES: TDemoSavedSearch[] = [
  {
    user: "buyer",
    query: {
      vehicleType: "bike",
      brand: "yamaha",
      model: "r15-v4",
      maxPrice: "500000",
      condition: "USED",
    },
    alertFrequency: SavedSearchAlertFrequency.INSTANT,
    pending: false,
  },
  {
    user: "buyer",
    query: {
      vehicleType: "bike",
      brand: "bajaj",
      model: "pulsar-n160",
      division: "Dhaka",
    },
    alertFrequency: SavedSearchAlertFrequency.DAILY,
    pending: true,
  },
  {
    user: "buyer2",
    query: { vehicleType: "bike", "spec.bikeCategory": "scooter" },
    alertFrequency: SavedSearchAlertFrequency.OFF,
    pending: false,
  },
];

/*
 * Saved searches for the demo buyers, with matches found by the real
 * matcher SQL. The buyer's R15 search has 2 "new" matches (after
 * lastViewedAt) and one price drop; the Pulsar search has matches
 * waiting for the daily digest. Idempotent per user + query.
 */
const seedDemoSavedSearches = async (users: TDemoUsers) => {
  let created = 0;

  for (const demo of DEMO_SAVED_SEARCHES) {
    const userId = users[demo.user].id;
    const query = canonicalizeSearchQuery(demo.query);
    const queryHash = hashSearchQuery(query);

    const exists = await prisma.savedSearch.findUnique({
      where: { userId_queryHash: { userId, queryHash } },
      select: { id: true },
    });

    if (exists) continue;

    const { filters } = await resolveSearchFilters(query);

    if (!filters) {
      console.log("Skipping demo saved search: filters not found", query);
      continue;
    }

    const [brands, models, vehicleType] = await Promise.all([
      prisma.brand.findMany({ select: { slug: true, name: true } }),
      prisma.vehicleModel.findMany({ select: { slug: true, name: true } }),
      prisma.vehicleType.findFirst({
        where: { slug: query.vehicleType ?? "" },
        select: { slug: true, name: true, attributes: true },
      }),
    ]);

    const name = buildSavedSearchName(
      describeSearchQuery(query, {
        vehicleTypes: new Map(
          vehicleType
            ? [
                [
                  vehicleType.slug,
                  {
                    name: vehicleType.name,
                    attributes: parseAttributes(vehicleType.attributes),
                  },
                ],
              ]
            : [],
        ),
        brands: new Map(brands.map((brand) => [brand.slug, brand.name])),
        models: new Map(models.map((model) => [model.slug, model.name])),
      }),
    );

    const savedSearch = await prisma.savedSearch.create({
      data: {
        userId,
        name,
        query,
        queryHash,
        vehicleTypeId: filters.vehicleTypeId ?? null,
        alertFrequency: demo.alertFrequency,
        // matches from the last 2 days count as "new"
        lastViewedAt: daysAgo(2),
        lastAlertedAt: demo.pending ? null : daysAgo(1),
      },
    });

    const candidates = await prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        isDeleted: false,
        sellerId: { not: userId },
      },
      orderBy: { approvedAt: "desc" },
      select: { id: true, price: true },
    });

    const matching: { id: string; price: unknown }[] = [];

    for (const candidate of candidates) {
      if (await listingMatchesFilters(filters, candidate.id)) {
        matching.push(candidate);
      }

      if (matching.length === 4) break;
    }

    for (const [index, listing] of matching.entries()) {
      // two fresh matches, the rest older than lastViewedAt
      const matchedAt = index < 2 ? daysAgo(index * 0.5) : daysAgo(3 + index);

      await prisma.savedSearchMatch.create({
        data: {
          savedSearchId: savedSearch.id,
          listingId: listing.id,
          kind: SavedSearchMatchKind.NEW_LISTING,
          matchedAt,
          notifiedAt: demo.pending ? null : matchedAt,
        },
      });
    }

    // one price drop on the oldest match of the instant search
    const dropped = matching[matching.length - 1];

    if (
      !demo.pending &&
      demo.alertFrequency === SavedSearchAlertFrequency.INSTANT &&
      dropped
    ) {
      const newPrice = Number(dropped.price);

      await prisma.savedSearchMatch.create({
        data: {
          savedSearchId: savedSearch.id,
          listingId: dropped.id,
          kind: SavedSearchMatchKind.PRICE_DROP,
          oldPrice: newPrice + 15000,
          newPrice,
          matchedAt: daysAgo(1),
          notifiedAt: daysAgo(1),
        },
      });
    }

    created += 1;
  }

  console.log(`Demo saved searches created: ${created}`);
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

    const users = await loadDemoUsers();

    if (users) {
      await seedDemoTrust(users);
      await seedModerationHistory(users);
      await seedVerificationRequests(users);
      await seedDemoEngagement(users);
      await seedDemoReviews(users);
      await seedDemoReports(users);
      await seedDemoOffers(users);
      await seedDemoTestRides(users);
      await seedDemoSavedSearches(users);
    } else {
      console.log("Some demo users are missing. Skipping demo activity.");
    }

    printDemoCredentials();

    console.log("Demo seeding completed successfully.");
  } catch (error) {
    console.error("Error running demo seed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

runSeed();
