import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction } from "../../../generated/prisma/enums";
import { VehicleModelWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { validateSpecs } from "../../helper/buildDynamicSpecSchema";
import { generateUniqueSlug } from "../../helper/generateSlug";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { buildAuditDiff, createAuditLog, TAuditActor } from "../../utils/auditLogger";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import { parseAttributes } from "../vehicleType/vehicleType.utils";
import {
  ICreateVehicleModelPayload,
  IUpdateVehicleModelPayload,
} from "./vehicleModel.interface";

const listInclude = {
  brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
  vehicleType: { select: { id: true, name: true, slug: true, icon: true } },
} satisfies Prisma.VehicleModelInclude;

// detail includes the full attribute schema so forms can render + auto-fill
const detailInclude = {
  brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
  vehicleType: {
    select: { id: true, name: true, slug: true, icon: true, attributes: true },
  },
} satisfies Prisma.VehicleModelInclude;

const uploadImage = async (image: Express.Multer.File | null) => {
  if (!image) return null;

  if (!image.mimetype.startsWith("image/")) {
    throw new AppError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "Image must be an image file");
  }

  return uploadToCloudinary(image, {
    folder: `${config.app_name.toLowerCase()}/vehicle-models`,
  });
};

/*
 * Brand must exist, vehicle type must exist, and the brand must be
 * linked to that vehicle type. Returns the type's attribute schema.
 */
const assertBrandAndType = async (brandId: string, vehicleTypeId: string) => {
  const [brand, vehicleType, link] = await Promise.all([
    prisma.brand.findUnique({ where: { id: brandId } }),
    prisma.vehicleType.findUnique({ where: { id: vehicleTypeId } }),
    prisma.brandVehicleType.findUnique({
      where: { brandId_vehicleTypeId: { brandId, vehicleTypeId } },
    }),
  ]);

  if (!brand) {
    throw new AppError(httpStatus.NOT_FOUND, "Brand not found");
  }

  if (!vehicleType) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle type not found");
  }

  if (!link) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${brand.name} is not linked to the ${vehicleType.name} vehicle type`,
    );
  }

  return parseAttributes(vehicleType.attributes);
};

const assertSpecsValid = (
  attributes: ReturnType<typeof parseAttributes>,
  specs: unknown,
) => {
  const result = validateSpecs(attributes, specs, { partial: true });

  if (!result.success) {
    throw new AppError(httpStatus.BAD_REQUEST, result.message);
  }

  return result.data;
};

const assertNameAvailable = async (
  brandId: string,
  name: string,
  excludeId?: string,
) => {
  const existing = await prisma.vehicleModel.findFirst({
    where: {
      brandId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId && { NOT: { id: excludeId } }),
    },
  });

  if (existing) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This brand already has a model with this name",
    );
  }
};

const createVehicleModel = async (
  payload: ICreateVehicleModelPayload,
  image: Express.Multer.File | null,
  actor: TAuditActor,
) => {
  const attributes = await assertBrandAndType(payload.brandId, payload.vehicleTypeId);

  const defaultSpecs = assertSpecsValid(attributes, payload.defaultSpecs);

  await assertNameAvailable(payload.brandId, payload.name);

  const slug =
    payload.slug ??
    (await generateUniqueSlug(payload.name, async (candidate) =>
      Boolean(
        await prisma.vehicleModel.findUnique({
          where: { brandId_slug: { brandId: payload.brandId, slug: candidate } },
        }),
      ),
    ));

  const imageResult = await uploadImage(image);

  const vehicleModel = await prisma.vehicleModel.create({
    data: {
      brandId: payload.brandId,
      vehicleTypeId: payload.vehicleTypeId,
      name: payload.name,
      slug,
      yearFrom: payload.yearFrom ?? null,
      yearTo: payload.yearTo ?? null,
      isActive: payload.isActive ?? true,
      defaultSpecs: defaultSpecs as Prisma.InputJsonValue,
      ...(imageResult && {
        imageUrl: imageResult.secure_url,
        imagePublicId: imageResult.public_id,
      }),
    },
    include: listInclude,
  });

  await createAuditLog({
    ...actor,
    action: AuditAction.CREATE,
    entity: "VehicleModel",
    entityId: vehicleModel.id,
    newData: {
      name: vehicleModel.name,
      slug: vehicleModel.slug,
      brandId: vehicleModel.brandId,
      vehicleTypeId: vehicleModel.vehicleTypeId,
      isActive: vehicleModel.isActive,
    },
  });

  return vehicleModel;
};

const getAllVehicleModels = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const orderBy = queryBuilder.buildSort(
    { sortBy: "name", sortOrder: "asc", ...query },
    ["name", "yearFrom", "createdAt", "updatedAt"],
    "name",
  );

  const andConditions: VehicleModelWhereInput[] = [];

  /*
   * Search (model name or brand name)
   */
  const searchCondition = queryBuilder.buildSearch(query.searchTerm, [
    "name",
    "brand.name",
  ]);

  if (searchCondition) {
    andConditions.push(searchCondition as VehicleModelWhereInput);
  }

  /*
   * Filters
   */
  if (query.brand) {
    andConditions.push({
      brand: isUuid(query.brand) ? { id: query.brand } : { slug: query.brand },
    });
  }

  if (query.vehicleType) {
    andConditions.push({
      vehicleType: isUuid(query.vehicleType)
        ? { id: query.vehicleType }
        : { slug: query.vehicleType },
    });
  }

  // models available in a given year
  if (query.year && !Number.isNaN(Number(query.year))) {
    const year = Number(query.year);

    andConditions.push(
      { OR: [{ yearFrom: null }, { yearFrom: { lte: year } }] },
      { OR: [{ yearTo: null }, { yearTo: { gte: year } }] },
    );
  }

  // public lists show active models only; admin pages pass isActive=all
  if (query.isActive !== "all") {
    andConditions.push({ isActive: query.isActive !== "false" });
  }

  const vehicleModels = await prisma.vehicleModel.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy,
    include: listInclude,
  });

  const total = await prisma.vehicleModel.count({
    where: { AND: andConditions },
  });

  return {
    data: vehicleModels,
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

/*
 * Accepts a uuid, or "brand-slug/model-slug" style lookup via ?brand=<slug>.
 */
const getVehicleModelByIdOrSlug = async (idOrSlug: string, brand?: string) => {
  let vehicleModel = null;

  if (isUuid(idOrSlug)) {
    vehicleModel = await prisma.vehicleModel.findUnique({
      where: { id: idOrSlug },
      include: detailInclude,
    });
  } else {
    vehicleModel = await prisma.vehicleModel.findFirst({
      where: {
        slug: idOrSlug,
        ...(brand && {
          brand: isUuid(brand) ? { id: brand } : { slug: brand },
        }),
      },
      include: detailInclude,
    });
  }

  if (!vehicleModel) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle model not found");
  }

  return vehicleModel;
};

const updateVehicleModel = async (
  id: string,
  payload: IUpdateVehicleModelPayload,
  image: Express.Multer.File | null,
  actor: TAuditActor,
) => {
  const existingModel = await prisma.vehicleModel.findUnique({ where: { id } });

  if (!existingModel) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle model not found");
  }

  const brandId = payload.brandId ?? existingModel.brandId;
  const vehicleTypeId = payload.vehicleTypeId ?? existingModel.vehicleTypeId;

  const attributes = await assertBrandAndType(brandId, vehicleTypeId);

  /*
   * Re-validate specs when they change OR when the vehicle type changes
   * (old specs may not fit the new type's schema).
   */
  const specsToValidate = payload.defaultSpecs ?? existingModel.defaultSpecs;
  const defaultSpecs =
    payload.defaultSpecs !== undefined || vehicleTypeId !== existingModel.vehicleTypeId
      ? assertSpecsValid(attributes, specsToValidate)
      : undefined;

  if (payload.name || payload.brandId) {
    await assertNameAvailable(brandId, payload.name ?? existingModel.name, id);
  }

  if (payload.slug) {
    const slugTaken = await prisma.vehicleModel.findFirst({
      where: { brandId, slug: payload.slug, NOT: { id } },
    });

    if (slugTaken) {
      throw new AppError(httpStatus.CONFLICT, "This brand already has a model with this slug");
    }
  }

  const yearFrom = payload.yearFrom === undefined ? existingModel.yearFrom : payload.yearFrom;
  const yearTo = payload.yearTo === undefined ? existingModel.yearTo : payload.yearTo;

  if (yearFrom && yearTo && yearFrom > yearTo) {
    throw new AppError(httpStatus.BAD_REQUEST, "Year from must be before year to");
  }

  const imageResult = await uploadImage(image);

  const { defaultSpecs: _ignored, ...rest } = payload;

  const vehicleModel = await prisma.vehicleModel.update({
    where: { id },
    data: {
      ...rest,
      ...(defaultSpecs && { defaultSpecs: defaultSpecs as Prisma.InputJsonValue }),
      ...(imageResult && {
        imageUrl: imageResult.secure_url,
        imagePublicId: imageResult.public_id,
      }),
    },
    include: listInclude,
  });

  // Side effects AFTER commit — remove the replaced image
  if (imageResult && existingModel.imagePublicId) {
    await deleteFromCloudinary(existingModel.imagePublicId);
  }

  const diff = buildAuditDiff(existingModel, {
    ...rest,
    defaultSpecs,
    imageUrl: imageResult?.secure_url,
  });

  if (diff.changed) {
    await createAuditLog({
      ...actor,
      action: AuditAction.UPDATE,
      entity: "VehicleModel",
      entityId: id,
      oldData: diff.oldData,
      newData: diff.newData,
    });
  }

  return vehicleModel;
};

const deleteVehicleModel = async (id: string, actor: TAuditActor) => {
  const vehicleModel = await prisma.vehicleModel.findUnique({ where: { id } });

  if (!vehicleModel) {
    throw new AppError(httpStatus.NOT_FOUND, "Vehicle model not found");
  }

  const listingCount = await prisma.listing.count({ where: { vehicleModelId: id } });

  if (listingCount > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot delete model because ${listingCount} listing(s) use it. Deactivate it instead.`,
    );
  }

  const deletedModel = await prisma.vehicleModel.delete({ where: { id } });

  await deleteFromCloudinary(vehicleModel.imagePublicId);

  await createAuditLog({
    ...actor,
    action: AuditAction.DELETE,
    entity: "VehicleModel",
    entityId: id,
    oldData: { name: vehicleModel.name, slug: vehicleModel.slug, brandId: vehicleModel.brandId },
  });

  return deletedModel;
};

export const VehicleModelService = {
  createVehicleModel,
  getAllVehicleModels,
  getVehicleModelByIdOrSlug,
  updateVehicleModel,
  deleteVehicleModel,
};
