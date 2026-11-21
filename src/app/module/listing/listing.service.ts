import crypto from "node:crypto";
import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
  AuditAction,
  ListingStatus,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import { ListingWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { findDistrict, isInsideBangladesh } from "../../helper/bdLocations";
import { validateSpecs } from "../../helper/buildDynamicSpecSchema";
import { isUuid } from "../../helper/isUuid";
import {
  sellerSummarySelect,
  toSellerBadges,
  toSellerSummary,
} from "../../helper/sellerBadges";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog } from "../../utils/auditLogger";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import { IRequestMeta } from "../auth/auth.interface";
import { recordRecentlyViewed } from "../recentlyViewed/recentlyViewed.utils";
import { parseAttributes } from "../vehicleType/vehicleType.utils";
import { TSpecs } from "../vehicleType/vehicleType.interface";
import {
  ICreateListingDraftPayload,
  IReorderListingImagesPayload,
  IUpdateListingPayload,
  IUpdateListingStatusPayload,
} from "./listing.interface";
import {
  EDITABLE_STATUSES,
  PUBLIC_STATUSES,
  assertListingOwner,
  assertTransition,
  buildSearchText,
  generateListingSlug,
  getCardSpecs,
  getSubmitProblems,
  isMajorEdit,
  isStaff,
  toNumber,
} from "./listing.utils";

type TDb = Prisma.TransactionClient | typeof prisma;

// ============================================
// Shapes
// ============================================

export const listingCardInclude = {
  images: {
    orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
    take: 1,
    select: { url: true },
  },
  brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
  vehicleModel: { select: { id: true, name: true, slug: true } },
  vehicleType: {
    select: { id: true, name: true, slug: true, attributes: true },
  },
  _count: { select: { images: true } },
  seller: { select: sellerSummarySelect },
} satisfies Prisma.ListingInclude;

type TListingCardRow = Prisma.ListingGetPayload<{
  include: typeof listingCardInclude;
}>;

export const toListingCard = (
  listing: TListingCardRow,
  distanceKm?: number | null,
) => ({
  id: listing.id,
  slug: listing.slug,
  title: listing.title,
  price: Number(listing.price),
  isNegotiable: listing.isNegotiable,
  condition: listing.condition,
  year: listing.year,
  mileage: listing.mileage,
  status: listing.status,
  division: listing.division,
  district: listing.district,
  area: listing.area,
  coverImageUrl: listing.images[0]?.url ?? null,
  imageCount: listing._count.images,
  brand: listing.brand,
  vehicleModel: listing.vehicleModel,
  vehicleType: {
    id: listing.vehicleType.id,
    name: listing.vehicleType.name,
    slug: listing.vehicleType.slug,
  },
  cardSpecs: getCardSpecs(
    parseAttributes(listing.vehicleType.attributes),
    listing.specs as TSpecs,
  ),
  viewsCount: listing.viewsCount,
  approvedAt: listing.approvedAt,
  submittedAt: listing.submittedAt,
  rejectionReason: listing.rejectionReason,
  expiresAt: listing.expiresAt,
  createdAt: listing.createdAt,
  updatedAt: listing.updatedAt,
  distanceKm: distanceKm ?? null,
  seller: toSellerSummary(listing.seller),
});

const detailInclude = {
  images: {
    orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }],
    select: { id: true, url: true, sortOrder: true, isCover: true },
  },
  seller: {
    select: {
      id: true,
      name: true,
      imageUrl: true,
      role: true,
      status: true,
      emailVerified: true,
      phoneVerified: true,
      idVerifiedAt: true,
      dealerVerifiedAt: true,
      ratingAverage: true,
      ratingCount: true,
      division: true,
      district: true,
      createdAt: true,
    },
  },
  brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
  vehicleModel: { select: { id: true, name: true, slug: true } },
  vehicleType: {
    select: { id: true, name: true, slug: true, icon: true, attributes: true },
  },
} satisfies Prisma.ListingInclude;

type TListingDetailRow = Prisma.ListingGetPayload<{
  include: typeof detailInclude;
}>;

const toListingDetail = (listing: TListingDetailRow) => {
  const { searchText: _searchText, ...rest } = listing;

  return {
    ...rest,
    price: Number(listing.price),
    latitude: toNumber(listing.latitude),
    longitude: toNumber(listing.longitude),
    vehicleType: {
      ...listing.vehicleType,
      attributes: parseAttributes(listing.vehicleType.attributes),
    },
    seller: {
      id: listing.seller.id,
      name: listing.seller.name,
      imageUrl: listing.seller.imageUrl,
      role: listing.seller.role,
      emailVerified: listing.seller.emailVerified,
      phoneVerified: listing.seller.phoneVerified,
      division: listing.seller.division,
      district: listing.seller.district,
      createdAt: listing.seller.createdAt,
      ratingAverage: Math.round(listing.seller.ratingAverage * 10) / 10,
      ratingCount: listing.seller.ratingCount,
      badges: toSellerBadges(listing.seller),
    },
  };
};

// ============================================
// Helpers
// ============================================

const findListingOrThrow = async (id: string, db: TDb = prisma) => {
  const listing = await db.listing.findFirst({
    where: { id, isDeleted: false },
  });

  if (!listing) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  return listing;
};

const getDetail = async (id: string, db: TDb = prisma) =>
  toListingDetail(
    await db.listing.findUniqueOrThrow({
      where: { id },
      include: detailInclude,
    }),
  );

/*
 * Vehicle type must be active, the brand linked to it, and the model
 * (when given) must belong to both. Returns names + the attribute schema.
 */
const resolveCatalog = async (
  vehicleTypeId: string,
  brandId: string,
  vehicleModelId: string | null | undefined,
) => {
  const [vehicleType, link, vehicleModel] = await Promise.all([
    prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } }),
    prisma.brandVehicleType.findUnique({
      where: { brandId_vehicleTypeId: { brandId, vehicleTypeId } },
      include: { brand: true },
    }),
    vehicleModelId
      ? prisma.vehicleModel.findUnique({ where: { id: vehicleModelId } })
      : null,
  ]);

  if (!vehicleType?.isActive) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle type not found");
  }

  if (!link?.brand.isActive) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `This brand is not available for ${vehicleType.name.toLowerCase()} listings`,
    );
  }

  if (vehicleModelId) {
    if (
      !vehicleModel?.isActive ||
      vehicleModel.brandId !== brandId ||
      vehicleModel.vehicleTypeId !== vehicleTypeId
    ) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "The selected model does not belong to this brand and vehicle type",
      );
    }
  }

  return {
    vehicleType,
    brand: link.brand,
    vehicleModel,
    attributes: parseAttributes(vehicleType.attributes),
  };
};

/*
 * Exact coordinates (validated) or the district centre.
 */
const resolveCoordinates = (
  division: string,
  district: string,
  latitude: number | null | undefined,
  longitude: number | null | undefined,
) => {
  if (
    latitude !== undefined &&
    latitude !== null &&
    longitude !== undefined &&
    longitude !== null
  ) {
    if (!isInsideBangladesh(latitude, longitude)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Location must be inside Bangladesh",
      );
    }

    return { latitude, longitude };
  }

  const centre = findDistrict(division, district);

  return centre
    ? { latitude: centre.lat, longitude: centre.lng }
    : { latitude: null, longitude: null };
};

/*
 * Keeps searchText + the full-text vector in sync (one raw UPDATE,
 * because Prisma cannot write tsvector columns).
 */
export const syncSearch = async (listingId: string, db: TDb = prisma) => {
  const listing = await db.listing.findUniqueOrThrow({
    where: { id: listingId },
    include: {
      brand: { select: { name: true } },
      vehicleModel: { select: { name: true } },
      vehicleType: { select: { name: true, attributes: true } },
    },
  });

  const searchText = buildSearchText({
    title: listing.title,
    year: listing.year,
    brandName: listing.brand.name,
    modelName: listing.vehicleModel?.name,
    vehicleTypeName: listing.vehicleType.name,
    division: listing.division,
    district: listing.district,
    area: listing.area,
    color: listing.color,
    attributes: parseAttributes(listing.vehicleType.attributes),
    specs: listing.specs as TSpecs,
  });

  await db.$executeRaw`
    UPDATE "listings"
    SET "searchText" = ${searchText},
        "search_vector" = to_tsvector('simple', ${searchText})
    WHERE "id" = ${listingId}
  `;
};

const listingRef = (listing: {
  id: string;
  sellerId: string;
  title: string;
  slug: string;
}) => ({
  listingId: listing.id,
  sellerId: listing.sellerId,
  title: listing.title,
  slug: listing.slug,
});

const expiryDate = () =>
  new Date(Date.now() + config.listing_duration_days * 24 * 60 * 60 * 1000);

// ============================================
// Create & update (owner)
// ============================================

const createListingDraft = async (
  requestUser: RequestUser,
  payload: ICreateListingDraftPayload,
) => {
  const seller = await prisma.user.findUniqueOrThrow({
    where: { id: requestUser.userId },
  });

  if (seller.status !== UserStatus.ACTIVE) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      seller.status === UserStatus.PENDING
        ? "Your dealer account is pending verification. You can post listings once it is approved."
        : "Your account cannot post listings",
    );
  }

  const { vehicleType, brand, vehicleModel, attributes } = await resolveCatalog(
    payload.vehicleTypeId,
    payload.brandId,
    payload.vehicleModelId,
  );

  // auto-fill specs from the model's defaults
  const defaultSpecs = vehicleModel
    ? validateSpecs(attributes, vehicleModel.defaultSpecs, { partial: true })
    : null;

  // pre-fill location from the seller's profile
  const hasProfileLocation = Boolean(
    seller.division &&
      seller.district &&
      findDistrict(seller.division, seller.district),
  );
  const division = hasProfileLocation ? (seller.division as string) : "";
  const district = hasProfileLocation ? (seller.district as string) : "";

  const title = [brand.name, vehicleModel?.name, payload.year]
    .filter(Boolean)
    .join(" ");

  const listing = await prisma.listing.create({
    data: {
      slug: generateListingSlug([brand.name, vehicleModel?.name, payload.year]),
      sellerId: seller.id,
      vehicleTypeId: vehicleType.id,
      brandId: brand.id,
      vehicleModelId: vehicleModel?.id ?? null,
      year: payload.year,
      title,
      price: 0,
      specs: (defaultSpecs?.success
        ? defaultSpecs.data
        : {}) as Prisma.InputJsonValue,
      division,
      district,
      area: hasProfileLocation ? seller.area : null,
      ...resolveCoordinates(division, district, null, null),
      status: ListingStatus.DRAFT,
    },
  });

  await syncSearch(listing.id);

  return getDetail(listing.id);
};

const updateListing = async (
  requestUser: RequestUser,
  id: string,
  payload: IUpdateListingPayload,
) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);

  if (!EDITABLE_STATUSES.includes(listing.status)) {
    throw new AppError(httpStatus.CONFLICT, "Sold listings cannot be edited");
  }

  const vehicleTypeId = payload.vehicleTypeId ?? listing.vehicleTypeId;
  const brandId = payload.brandId ?? listing.brandId;
  const vehicleModelId =
    payload.vehicleModelId === undefined
      ? listing.vehicleModelId
      : payload.vehicleModelId;

  const { attributes } = await resolveCatalog(
    vehicleTypeId,
    brandId,
    vehicleModelId,
  );

  /*
   * Specs: drafts/rejected may be incomplete; submitted listings must stay complete.
   * A new vehicle type without new specs starts with empty specs.
   */
  const typeChanged = vehicleTypeId !== listing.vehicleTypeId;
  const specsInput = payload.specs ?? (typeChanged ? {} : listing.specs);
  const isIncompleteAllowed =
    listing.status === ListingStatus.DRAFT ||
    listing.status === ListingStatus.REJECTED;

  let specs: TSpecs | undefined;

  if (payload.specs !== undefined || typeChanged) {
    const result = validateSpecs(attributes, specsInput, {
      partial: isIncompleteAllowed,
    });

    if (!result.success) {
      throw new AppError(httpStatus.BAD_REQUEST, result.message);
    }

    specs = result.data;
  }

  /*
   * Location: both parts must form a valid pair; coordinates follow the district
   * unless exact ones are sent.
   */
  const locationChanged =
    payload.division !== undefined ||
    payload.district !== undefined ||
    payload.latitude !== undefined;

  let location:
    | {
        division: string;
        district: string;
        latitude: number | null;
        longitude: number | null;
      }
    | undefined;

  if (locationChanged) {
    const division = payload.division ?? listing.division;
    const district = payload.district ?? listing.district;

    if ((division || district) && !findDistrict(division, district)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Choose a valid division and district",
      );
    }

    location = {
      division,
      district,
      ...resolveCoordinates(
        division,
        district,
        payload.latitude,
        payload.longitude,
      ),
    };
  }

  /*
   * Approved listings go back to review on major edits.
   */
  const comparable = {
    ...listing,
    latitude: toNumber(listing.latitude),
    longitude: toNumber(listing.longitude),
  };
  const backToReview =
    listing.status === ListingStatus.APPROVED &&
    isMajorEdit(comparable, {
      ...payload,
      ...(specs && { specs }),
      vehicleModelId,
    });

  const oldPrice = Number(listing.price);
  const isPriceDrop =
    listing.status === ListingStatus.APPROVED &&
    !backToReview &&
    payload.price !== undefined &&
    payload.price < oldPrice;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.listing.update({
      where: { id },
      data: {
        vehicleTypeId,
        brandId,
        vehicleModelId,
        ...(payload.year !== undefined && { year: payload.year }),
        ...(payload.title !== undefined && { title: payload.title }),
        ...(payload.description !== undefined && {
          description: payload.description,
        }),
        ...(payload.price !== undefined && { price: payload.price }),
        ...(payload.isNegotiable !== undefined && {
          isNegotiable: payload.isNegotiable,
        }),
        ...(payload.condition !== undefined && {
          condition: payload.condition,
        }),
        ...(payload.mileage !== undefined && { mileage: payload.mileage }),
        ...(payload.color !== undefined && { color: payload.color || null }),
        ...(payload.videoUrl !== undefined && {
          videoUrl: payload.videoUrl || null,
        }),
        ...(payload.area !== undefined && { area: payload.area || null }),
        ...(specs && { specs: specs as Prisma.InputJsonValue }),
        ...location,
        ...(backToReview && {
          status: ListingStatus.PENDING,
          submittedAt: new Date(),
        }),
      },
    });

    await syncSearch(id, tx);

    return result;
  });

  // Side effects AFTER commit
  if (backToReview) {
    appEvents.emit("listing.submitted", listingRef(updated));
  }

  if (isPriceDrop) {
    appEvents.emit("listing.priceDropped", {
      ...listingRef(updated),
      oldPrice,
      newPrice: Number(updated.price),
    });
  }

  return { ...(await getDetail(id)), sentBackToReview: backToReview };
};

// ============================================
// Images (owner)
// ============================================

const addListingImages = async (
  requestUser: RequestUser,
  id: string,
  files: Express.Multer.File[],
) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);

  if (!EDITABLE_STATUSES.includes(listing.status)) {
    throw new AppError(httpStatus.CONFLICT, "Sold listings cannot be edited");
  }

  if (files.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "Choose at least one photo");
  }

  if (files.some((file) => !file.mimetype.startsWith("image/"))) {
    throw new AppError(
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
      "Only image files can be uploaded",
    );
  }

  const existing = await prisma.listingImage.findMany({
    where: { listingId: id },
    orderBy: { sortOrder: "desc" },
  });

  if (existing.length + files.length > config.max_listing_images) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `A listing can have at most ${config.max_listing_images} photos (${existing.length} already added)`,
    );
  }

  const uploads = await Promise.allSettled(
    files.map((file) =>
      uploadToCloudinary(file, {
        folder: `${config.app_name.toLowerCase()}/listings/${id}`,
      }),
    ),
  );

  const uploaded = uploads
    .filter((result) => result.status === "fulfilled")
    .map(
      (result) =>
        (
          result as PromiseFulfilledResult<{
            secure_url: string;
            public_id: string;
          }>
        ).value,
    );

  // all-or-nothing: clean up partial uploads
  if (uploaded.length !== files.length) {
    await Promise.all(
      uploaded.map((image) => deleteFromCloudinary(image.public_id)),
    );
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Photo upload failed. Please try again.",
    );
  }

  const nextSortOrder = (existing[0]?.sortOrder ?? -1) + 1;
  const hasCover = existing.some((image) => image.isCover);
  const backToReview = listing.status === ListingStatus.APPROVED;

  await prisma.$transaction(async (tx) => {
    await tx.listingImage.createMany({
      data: uploaded.map((image, index) => ({
        listingId: id,
        url: image.secure_url,
        publicId: image.public_id,
        sortOrder: nextSortOrder + index,
        isCover: !hasCover && index === 0,
      })),
    });

    // new photos on a live listing are reviewed again
    if (backToReview) {
      await tx.listing.update({
        where: { id },
        data: { status: ListingStatus.PENDING, submittedAt: new Date() },
      });
    }
  });

  if (backToReview) {
    appEvents.emit("listing.submitted", listingRef(listing));
  }

  return { ...(await getDetail(id)), sentBackToReview: backToReview };
};

const reorderListingImages = async (
  requestUser: RequestUser,
  id: string,
  payload: IReorderListingImagesPayload,
) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);

  const images = await prisma.listingImage.findMany({
    where: { listingId: id },
  });

  const currentIds = new Set(images.map((image) => image.id));
  const order = Array.from(new Set(payload.order));

  if (
    order.length !== currentIds.size ||
    order.some((imageId) => !currentIds.has(imageId))
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Order must contain every photo of this listing exactly once",
    );
  }

  const coverImageId =
    payload.coverImageId ??
    images.find((image) => image.isCover)?.id ??
    order[0];

  if (!currentIds.has(coverImageId)) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Cover photo must belong to this listing",
    );
  }

  await prisma.$transaction(
    order.map((imageId, index) =>
      prisma.listingImage.update({
        where: { id: imageId },
        data: { sortOrder: index, isCover: imageId === coverImageId },
      }),
    ),
  );

  return getDetail(id);
};

const deleteListingImage = async (
  requestUser: RequestUser,
  id: string,
  imageId: string,
) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);

  const images = await prisma.listingImage.findMany({
    where: { listingId: id },
    orderBy: { sortOrder: "asc" },
  });

  const image = images.find((item) => item.id === imageId);

  if (!image) {
    throw new AppError(httpStatus.NOT_FOUND, "Photo not found");
  }

  if (listing.status !== ListingStatus.DRAFT && images.length === 1) {
    throw new AppError(
      httpStatus.CONFLICT,
      "A listing needs at least one photo",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.listingImage.delete({ where: { id: imageId } });

    const nextCover = images.find((item) => item.id !== imageId);

    if (image.isCover && nextCover) {
      await tx.listingImage.update({
        where: { id: nextCover.id },
        data: { isCover: true },
      });
    }
  });

  // Side effects AFTER commit
  await deleteFromCloudinary(image.publicId);

  return getDetail(id);
};

// ============================================
// Status changes
// ============================================

const submitListing = async (requestUser: RequestUser, id: string) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);
  assertTransition(listing.status, ListingStatus.PENDING);

  const [vehicleType, imageCount] = await Promise.all([
    prisma.vehicleType.findUniqueOrThrow({
      where: { id: listing.vehicleTypeId },
    }),
    prisma.listingImage.count({ where: { listingId: id } }),
  ]);

  const problems = getSubmitProblems(
    listing,
    imageCount,
    parseAttributes(vehicleType.attributes),
  );

  if (problems.length > 0) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Your listing is not ready yet: ${problems.join("; ")}`,
    );
  }

  const updated = await prisma.listing.update({
    where: { id },
    data: {
      status: ListingStatus.PENDING,
      submittedAt: new Date(),
      rejectionReason: null,
    },
  });

  appEvents.emit("listing.submitted", listingRef(updated));

  return getDetail(id);
};

const updateListingStatus = async (
  staff: RequestUser,
  id: string,
  payload: IUpdateListingStatusPayload,
  meta: IRequestMeta,
) => {
  const listing = await findListingOrThrow(id);

  const isApprove = payload.status === ListingStatus.APPROVED;

  assertTransition(
    listing.status,
    isApprove ? ListingStatus.APPROVED : ListingStatus.REJECTED,
  );

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.listing.update({
      where: { id },
      data: isApprove
        ? {
            status: ListingStatus.APPROVED,
            approvedAt: new Date(),
            approvedById: staff.userId,
            expiresAt: expiryDate(),
            rejectionReason: null,
          }
        : {
            status: ListingStatus.REJECTED,
            rejectionReason: payload.reason ?? null,
          },
    });

    await createAuditLog(
      {
        userId: staff.userId,
        action: isApprove ? AuditAction.APPROVE : AuditAction.REJECT,
        entity: "Listing",
        entityId: id,
        oldData: { status: listing.status },
        newData: { status: result.status, reason: payload.reason ?? null },
        ...meta,
      },
      tx,
    );

    return result;
  });

  // Side effects AFTER commit
  if (isApprove) {
    appEvents.emit("listing.approved", {
      ...listingRef(updated),
      approvedById: staff.userId,
    });
  } else {
    appEvents.emit("listing.rejected", {
      ...listingRef(updated),
      reason: payload.reason ?? "",
      rejectedById: staff.userId,
    });
  }

  return getDetail(id);
};

const markListingSold = async (requestUser: RequestUser, id: string) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);
  assertTransition(listing.status, ListingStatus.SOLD);

  const updated = await prisma.listing.update({
    where: { id },
    data: { status: ListingStatus.SOLD, soldAt: new Date() },
  });

  appEvents.emit("listing.sold", listingRef(updated));

  return getDetail(id);
};

const renewListing = async (requestUser: RequestUser, id: string) => {
  const listing = await findListingOrThrow(id);

  assertListingOwner(listing, requestUser.userId);

  if (listing.status !== ListingStatus.EXPIRED) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Only expired listings can be renewed",
    );
  }

  await prisma.listing.update({
    where: { id },
    data: { status: ListingStatus.APPROVED, expiresAt: expiryDate() },
  });

  return getDetail(id);
};

const deleteListing = async (
  requestUser: RequestUser,
  id: string,
  meta: IRequestMeta,
) => {
  const listing = await findListingOrThrow(id);

  const isAdmin =
    requestUser.role === Role.ADMIN || requestUser.role === Role.SUPER_ADMIN;

  if (!isAdmin) {
    assertListingOwner(listing, requestUser.userId);
  }

  await prisma.$transaction(async (tx) => {
    await tx.listing.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    if (isAdmin && listing.sellerId !== requestUser.userId) {
      await createAuditLog(
        {
          userId: requestUser.userId,
          action: AuditAction.DELETE,
          entity: "Listing",
          entityId: id,
          ...meta,
        },
        tx,
      );
    }
  });
};

// ============================================
// Reads
// ============================================

const getMyListings = async (userId: string, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 12);

  const andConditions: ListingWhereInput[] = [
    { sellerId: userId },
    { isDeleted: false },
  ];

  if (query.status && Object.values(ListingStatus).includes(query.status)) {
    andConditions.push({ status: query.status });
  }

  if (query.searchTerm) {
    andConditions.push({
      title: { contains: query.searchTerm, mode: "insensitive" },
    });
  }

  const [listings, total, statusCounts] = await Promise.all([
    prisma.listing.findMany({
      where: { AND: andConditions },
      take: limit,
      skip,
      orderBy: { updatedAt: "desc" },
      include: listingCardInclude,
    }),
    prisma.listing.count({ where: { AND: andConditions } }),
    prisma.listing.groupBy({
      by: ["status"],
      where: { sellerId: userId, isDeleted: false },
      _count: { _all: true },
    }),
  ]);

  return {
    data: listings.map((listing) => toListingCard(listing)),
    meta: {
      ...queryBuilder.buildMeta(page, limit, total),
      statusCounts: Object.fromEntries(
        statusCounts.map((item) => [item.status, item._count._all]),
      ),
    },
  };
};

const getManagedListings = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const andConditions: ListingWhereInput[] = [{ isDeleted: false }];

  if (query.status && Object.values(ListingStatus).includes(query.status)) {
    andConditions.push({ status: query.status });
  } else {
    // drafts are private work-in-progress
    andConditions.push({ status: { not: ListingStatus.DRAFT } });
  }

  if (query.searchTerm) {
    andConditions.push({
      OR: [
        { title: { contains: query.searchTerm, mode: "insensitive" } },
        { searchText: { contains: query.searchTerm, mode: "insensitive" } },
        {
          seller: { name: { contains: query.searchTerm, mode: "insensitive" } },
        },
      ],
    });
  }

  if (query.vehicleType) {
    andConditions.push({
      vehicleType: isUuid(query.vehicleType)
        ? { id: query.vehicleType }
        : { slug: query.vehicleType },
    });
  }

  if (query.brand) {
    andConditions.push({
      brand: isUuid(query.brand) ? { id: query.brand } : { slug: query.brand },
    });
  }

  if (query.sellerId && isUuid(query.sellerId)) {
    andConditions.push({ sellerId: query.sellerId });
  }

  // the moderation queue is first-come, first-served
  const orderBy: Prisma.ListingOrderByWithRelationInput =
    query.status === ListingStatus.PENDING
      ? { submittedAt: "asc" }
      : { updatedAt: "desc" };

  const [listings, total, statusCounts] = await Promise.all([
    prisma.listing.findMany({
      where: { AND: andConditions },
      take: limit,
      skip,
      orderBy,
      include: {
        ...listingCardInclude,
        seller: { select: { ...sellerSummarySelect, email: true } },
      },
    }),
    prisma.listing.count({ where: { AND: andConditions } }),
    prisma.listing.groupBy({
      by: ["status"],
      where: { isDeleted: false, status: { not: ListingStatus.DRAFT } },
      _count: { _all: true },
    }),
  ]);

  return {
    data: listings.map((listing) => ({
      ...toListingCard(listing),
      seller: {
        ...toSellerSummary(listing.seller),
        email: listing.seller.email,
      },
    })),
    meta: {
      ...queryBuilder.buildMeta(page, limit, total),
      statusCounts: Object.fromEntries(
        statusCounts.map((item) => [item.status, item._count._all]),
      ),
    },
  };
};

/*
 * Public detail. Unapproved listings are visible only to the owner and staff.
 * A view is counted once per viewer per 24h, never for the owner.
 */
const getListingByIdOrSlug = async (
  idOrSlug: string,
  viewer: RequestUser | undefined,
  meta: IRequestMeta,
) => {
  const listing = await prisma.listing.findFirst({
    where: {
      ...(isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
      isDeleted: false,
    },
    include: detailInclude,
  });

  const isOwner = Boolean(
    viewer && listing && listing.sellerId === viewer.userId,
  );
  const canSeeUnpublished = isOwner || isStaff(viewer?.role);

  if (
    !listing ||
    (!PUBLIC_STATUSES.includes(listing.status) && !canSeeUnpublished)
  ) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  if (listing.status === ListingStatus.APPROVED && !isOwner) {
    const viewerKey =
      viewer?.userId ??
      crypto
        .createHash("sha256")
        .update(`${meta.ipAddress ?? ""}|${meta.userAgent ?? ""}`)
        .digest("hex")
        .slice(0, 24);

    try {
      const isNewView = await redisClient.set(
        `listing-view:${listing.id}:${viewerKey}`,
        "1",
        {
          condition: "NX",
          expiration: { type: "EX", value: 24 * 60 * 60 },
        },
      );

      if (isNewView) {
        // raw update: counting a view must not bump updatedAt
        await prisma.$executeRaw`
          UPDATE "listings" SET "viewsCount" = "viewsCount" + 1 WHERE "id" = ${listing.id}
        `;
        listing.viewsCount += 1;
      }
    } catch (error) {
      console.error("View counting failed:", error);
    }
  }

  if (viewer && !isOwner && PUBLIC_STATUSES.includes(listing.status)) {
    recordRecentlyViewed(viewer.userId, listing.id).catch((error) =>
      console.error("Recording recently viewed failed:", error),
    );
  }

  return { ...toListingDetail(listing), isOwner };
};

const getSimilarListings = async (idOrSlug: string) => {
  const listing = await prisma.listing.findFirst({
    where: {
      ...(isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
      isDeleted: false,
      status: { in: PUBLIC_STATUSES },
    },
  });

  if (!listing) {
    throw new AppError(httpStatus.NOT_FOUND, "Listing not found");
  }

  const price = Number(listing.price);

  const candidates = await prisma.listing.findMany({
    where: {
      id: { not: listing.id },
      isDeleted: false,
      status: ListingStatus.APPROVED,
      vehicleTypeId: listing.vehicleTypeId,
      OR: [
        ...(listing.vehicleModelId
          ? [{ vehicleModelId: listing.vehicleModelId }]
          : []),
        { brandId: listing.brandId },
        { price: { gte: price * 0.75, lte: price * 1.25 } },
      ],
    },
    orderBy: { approvedAt: "desc" },
    take: 24,
    include: listingCardInclude,
  });

  // same model first, then same brand, then closest price
  const score = (candidate: (typeof candidates)[number]) =>
    (candidate.vehicleModelId &&
    candidate.vehicleModelId === listing.vehicleModelId
      ? 0
      : 2) +
    (candidate.brandId === listing.brandId ? 0 : 1) +
    Math.abs(Number(candidate.price) - price) / Math.max(price, 1);

  return candidates
    .sort((first, second) => score(first) - score(second))
    .slice(0, 8)
    .map((candidate) => toListingCard(candidate));
};

// ============================================
// Cron
// ============================================

const expireListings = async () => {
  const expired = await prisma.listing.findMany({
    where: {
      status: ListingStatus.APPROVED,
      isDeleted: false,
      expiresAt: { lt: new Date() },
    },
    select: { id: true, sellerId: true, title: true, slug: true },
  });

  if (expired.length === 0) return 0;

  await prisma.listing.updateMany({
    where: { id: { in: expired.map((listing) => listing.id) } },
    data: { status: ListingStatus.EXPIRED },
  });

  for (const listing of expired) {
    appEvents.emit("listing.expired", listingRef(listing));
  }

  return expired.length;
};

export const ListingService = {
  createListingDraft,
  updateListing,
  addListingImages,
  reorderListingImages,
  deleteListingImage,
  submitListing,
  updateListingStatus,
  markListingSold,
  renewListing,
  deleteListing,
  getMyListings,
  getManagedListings,
  getListingByIdOrSlug,
  getSimilarListings,
  expireListings,
};
