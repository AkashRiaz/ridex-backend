import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { VehicleTypeWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { generateUniqueSlug } from "../../helper/generateSlug";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import {
  ICreateVehicleTypePayload,
  IUpdateVehicleTypeAttributesPayload,
  IUpdateVehicleTypePayload,
} from "./vehicleType.interface";
import {
  findSpecConflicts,
  vehicleTypeSortableFields,
} from "./vehicleType.utils";

const uploadImage = async (image: Express.Multer.File | null) => {
  if (!image) return null;

  if (!image.mimetype.startsWith("image/")) {
    throw new AppError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "Image must be an image file");
  }

  return uploadToCloudinary(image, {
    folder: `${config.app_name.toLowerCase()}/vehicle-types`,
  });
};

const withCounts = {
  _count: {
    select: {
      brands: true,
      models: true,
    },
  },
} satisfies Prisma.VehicleTypeInclude;

const assertNameAndSlugAvailable = async (
  name: string | undefined,
  slug: string | undefined,
  excludeId?: string,
) => {
  if (!name && !slug) return;

  const existing = await prisma.vehicleType.findFirst({
    where: {
      OR: [
        ...(name ? [{ name: { equals: name, mode: "insensitive" as const } }] : []),
        ...(slug ? [{ slug }] : []),
      ],
      ...(excludeId && { NOT: { id: excludeId } }),
    },
  });

  if (existing) {
    throw new AppError(
      httpStatus.CONFLICT,
      "A vehicle type with this name or slug already exists",
    );
  }
};

const findVehicleTypeOrThrow = async (id: string) => {
  const vehicleType = await prisma.vehicleType.findUnique({ where: { id } });

  if (!vehicleType) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle type not found");
  }

  return vehicleType;
};

const createVehicleType = async (
  payload: ICreateVehicleTypePayload,
  image: Express.Multer.File | null,
) => {
  await assertNameAndSlugAvailable(payload.name, payload.slug);

  const slug =
    payload.slug ??
    (await generateUniqueSlug(payload.name, async (candidate) =>
      Boolean(await prisma.vehicleType.findUnique({ where: { slug: candidate } })),
    ));

  const imageResult = await uploadImage(image);

  return prisma.vehicleType.create({
    data: {
      name: payload.name,
      slug,
      description: payload.description ?? null,
      icon: payload.icon ?? null,
      sortOrder: payload.sortOrder ?? 0,
      isActive: payload.isActive ?? true,
      attributes: (payload.attributes ?? []) as unknown as Prisma.InputJsonValue,
      ...(imageResult && {
        imageUrl: imageResult.secure_url,
        imagePublicId: imageResult.public_id,
      }),
    },
    include: withCounts,
  });
};

const getAllVehicleTypes = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 50);

  const orderBy = queryBuilder.buildSort(
    { sortBy: "sortOrder", sortOrder: "asc", ...query },
    vehicleTypeSortableFields,
    "sortOrder",
  );

  const andConditions: VehicleTypeWhereInput[] = [];

  /*
   * Search
   */
  const searchCondition = queryBuilder.buildSearch(query.searchTerm, [
    "name",
    "slug",
    "description",
  ]);

  if (searchCondition) {
    andConditions.push(searchCondition as VehicleTypeWhereInput);
  }

  /*
   * Public lists show active types only; admin pages pass isActive=all
   */
  if (query.isActive !== "all") {
    andConditions.push({ isActive: query.isActive !== "false" });
  }

  const vehicleTypes = await prisma.vehicleType.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy,
    include: withCounts,
  });

  const total = await prisma.vehicleType.count({
    where: { AND: andConditions },
  });

  return {
    data: vehicleTypes,
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getVehicleTypeByIdOrSlug = async (idOrSlug: string) => {
  const vehicleType = await prisma.vehicleType.findUnique({
    where: isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug },
    include: withCounts,
  });

  if (!vehicleType) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle type not found");
  }

  return vehicleType;
};

const updateVehicleType = async (
  id: string,
  payload: IUpdateVehicleTypePayload,
  image: Express.Multer.File | null,
) => {
  const existingVehicleType = await findVehicleTypeOrThrow(id);

  await assertNameAndSlugAvailable(payload.name, payload.slug, id);

  const imageResult = await uploadImage(image);

  const vehicleType = await prisma.vehicleType.update({
    where: { id },
    data: {
      ...payload,
      ...(imageResult && {
        imageUrl: imageResult.secure_url,
        imagePublicId: imageResult.public_id,
      }),
    },
    include: withCounts,
  });

  // Side effects AFTER commit — remove the replaced image
  if (imageResult && existingVehicleType.imagePublicId) {
    await deleteFromCloudinary(existingVehicleType.imagePublicId);
  }

  return vehicleType;
};

/*
 * Replaces the whole attribute schema. Rejected with 409 when any
 * existing model's default specs would no longer be valid.
 */
const updateVehicleTypeAttributes = async (
  id: string,
  payload: IUpdateVehicleTypeAttributesPayload,
) => {
  await findVehicleTypeOrThrow(id);

  return prisma.$transaction(async (tx) => {
    const models = await tx.vehicleModel.findMany({
      where: { vehicleTypeId: id },
      select: { id: true, name: true, defaultSpecs: true },
    });

    // listings are checked like models (partial): new required fields only apply to new edits
    const listings = await tx.listing.findMany({
      where: { vehicleTypeId: id, isDeleted: false },
      select: { id: true, title: true, specs: true },
    });

    const conflicts = findSpecConflicts(payload.attributes, [
      ...models,
      ...listings.map((listing) => ({
        id: listing.id,
        name: `listing "${listing.title}"`,
        defaultSpecs: listing.specs,
      })),
    ]);

    if (conflicts.length > 0) {
      const preview = conflicts
        .slice(0, 5)
        .map((conflict) => `${conflict.name} (${conflict.reason})`)
        .join("; ");

      throw new AppError(
        httpStatus.CONFLICT,
        `This change would make ${conflicts.length} model(s)/listing(s) invalid: ${preview}${
          conflicts.length > 5 ? "; ..." : ""
        }. Update those first.`,
      );
    }

    return tx.vehicleType.update({
      where: { id },
      data: {
        attributes: payload.attributes as unknown as Prisma.InputJsonValue,
      },
      include: withCounts,
    });
  });
};

const deleteVehicleType = async (id: string) => {
  const vehicleType = await findVehicleTypeOrThrow(id);

  const [brandCount, modelCount, listingCount] = await Promise.all([
    prisma.brandVehicleType.count({ where: { vehicleTypeId: id } }),
    prisma.vehicleModel.count({ where: { vehicleTypeId: id } }),
    prisma.listing.count({ where: { vehicleTypeId: id } }),
  ]);

  if (brandCount > 0 || modelCount > 0 || listingCount > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot delete vehicle type because ${brandCount} brand(s), ${modelCount} model(s) and ${listingCount} listing(s) use it. Deactivate it instead.`,
    );
  }

  const deletedVehicleType = await prisma.vehicleType.delete({ where: { id } });

  await deleteFromCloudinary(vehicleType.imagePublicId);

  return deletedVehicleType;
};

export const VehicleTypeService = {
  createVehicleType,
  getAllVehicleTypes,
  getVehicleTypeByIdOrSlug,
  updateVehicleType,
  updateVehicleTypeAttributes,
  deleteVehicleType,
};
