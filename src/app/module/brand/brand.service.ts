import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction } from "../../../generated/prisma/enums";
import { BrandWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
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
import { ICreateBrandPayload, IUpdateBrandPayload } from "./brand.interface";

const brandInclude = {
  vehicleTypes: {
    select: {
      vehicleType: {
        select: { id: true, name: true, slug: true, icon: true },
      },
    },
  },
  _count: {
    select: { models: true },
  },
} satisfies Prisma.BrandInclude;

type TBrandWithRelations = Prisma.BrandGetPayload<{ include: typeof brandInclude }>;

/*
 * Flattens the join table: vehicleTypes: [{ vehicleType }] → vehicleTypes: [vehicleType]
 */
const formatBrand = (brand: TBrandWithRelations) => ({
  ...brand,
  vehicleTypes: brand.vehicleTypes.map((link) => link.vehicleType),
});

const uploadLogo = async (logo: Express.Multer.File | null) => {
  if (!logo) return null;

  if (!logo.mimetype.startsWith("image/")) {
    throw new AppError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "Logo must be an image file");
  }

  return uploadToCloudinary(logo, {
    folder: `${config.app_name.toLowerCase()}/brands`,
  });
};

const assertVehicleTypesExist = async (vehicleTypeIds: string[]) => {
  const count = await prisma.vehicleType.count({
    where: { id: { in: vehicleTypeIds } },
  });

  if (count !== vehicleTypeIds.length) {
    throw new AppError(httpStatus.NOT_FOUND, "One or more vehicle types were not found");
  }
};

const assertNameAndSlugAvailable = async (
  name: string | undefined,
  slug: string | undefined,
  excludeId?: string,
) => {
  if (!name && !slug) return;

  const existing = await prisma.brand.findFirst({
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
      "A brand with this name or slug already exists",
    );
  }
};

const createBrand = async (
  payload: ICreateBrandPayload,
  logo: Express.Multer.File | null,
  actor: TAuditActor,
) => {
  const { vehicleTypeIds, ...brandData } = payload;

  await assertNameAndSlugAvailable(brandData.name, brandData.slug);
  await assertVehicleTypesExist(vehicleTypeIds);

  const slug =
    brandData.slug ??
    (await generateUniqueSlug(brandData.name, async (candidate) =>
      Boolean(await prisma.brand.findUnique({ where: { slug: candidate } })),
    ));

  const logoResult = await uploadLogo(logo);

  const brand = await prisma.brand.create({
    data: {
      ...brandData,
      slug,
      ...(logoResult && {
        logoUrl: logoResult.secure_url,
        logoPublicId: logoResult.public_id,
      }),
      vehicleTypes: {
        create: vehicleTypeIds.map((vehicleTypeId) => ({ vehicleTypeId })),
      },
    },
    include: brandInclude,
  });

  await createAuditLog({
    ...actor,
    action: AuditAction.CREATE,
    entity: "Brand",
    entityId: brand.id,
    newData: { name: brand.name, slug: brand.slug, isActive: brand.isActive, vehicleTypeIds },
  });

  return formatBrand(brand);
};

const getAllBrands = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const orderBy = queryBuilder.buildSort(
    { sortBy: "name", sortOrder: "asc", ...query },
    ["name", "createdAt", "updatedAt"],
    "name",
  );

  const andConditions: BrandWhereInput[] = [];

  /*
   * Search
   */
  const searchCondition = queryBuilder.buildSearch(query.searchTerm, [
    "name",
    "slug",
    "country",
  ]);

  if (searchCondition) {
    andConditions.push(searchCondition as BrandWhereInput);
  }

  /*
   * Filters
   */
  if (query.vehicleType) {
    andConditions.push({
      vehicleTypes: {
        some: {
          vehicleType: isUuid(query.vehicleType)
            ? { id: query.vehicleType }
            : { slug: query.vehicleType },
        },
      },
    });
  }

  if (query.isPopular) {
    andConditions.push({ isPopular: query.isPopular === "true" });
  }

  // public lists show active brands only; admin pages pass isActive=all
  if (query.isActive !== "all") {
    andConditions.push({ isActive: query.isActive !== "false" });
  }

  const brands = await prisma.brand.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy,
    include: brandInclude,
  });

  const total = await prisma.brand.count({
    where: { AND: andConditions },
  });

  return {
    data: brands.map(formatBrand),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getBrandByIdOrSlug = async (idOrSlug: string) => {
  const brand = await prisma.brand.findUnique({
    where: isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug },
    include: brandInclude,
  });

  if (!brand) {
    throw new AppError(httpStatus.NOT_FOUND, "Brand not found");
  }

  return formatBrand(brand);
};

const updateBrand = async (
  id: string,
  payload: IUpdateBrandPayload,
  logo: Express.Multer.File | null,
  actor: TAuditActor,
) => {
  const existingBrand = await prisma.brand.findUnique({ where: { id } });

  if (!existingBrand) {
    throw new AppError(httpStatus.NOT_FOUND, "Brand not found");
  }

  const { vehicleTypeIds, ...brandData } = payload;

  await assertNameAndSlugAvailable(brandData.name, brandData.slug, id);

  if (vehicleTypeIds) {
    await assertVehicleTypesExist(vehicleTypeIds);

    /*
     * A vehicle type cannot be unlinked while this brand
     * still has models of that type.
     */
    const modelsOfRemovedTypes = await prisma.vehicleModel.count({
      where: { brandId: id, vehicleTypeId: { notIn: vehicleTypeIds } },
    });

    if (modelsOfRemovedTypes > 0) {
      throw new AppError(
        httpStatus.CONFLICT,
        `Cannot remove a vehicle type that still has ${modelsOfRemovedTypes} model(s) of this brand`,
      );
    }
  }

  const logoResult = await uploadLogo(logo);

  const previousVehicleTypeIds = vehicleTypeIds
    ? (await prisma.brandVehicleType.findMany({ where: { brandId: id }, select: { vehicleTypeId: true } }))
        .map((link) => link.vehicleTypeId)
        .sort()
    : undefined;

  const brand = await prisma.$transaction(async (tx) => {
    if (vehicleTypeIds) {
      await tx.brandVehicleType.deleteMany({ where: { brandId: id } });
      await tx.brandVehicleType.createMany({
        data: vehicleTypeIds.map((vehicleTypeId) => ({ brandId: id, vehicleTypeId })),
      });
    }

    return tx.brand.update({
      where: { id },
      data: {
        ...brandData,
        ...(logoResult && {
          logoUrl: logoResult.secure_url,
          logoPublicId: logoResult.public_id,
        }),
      },
      include: brandInclude,
    });
  });

  // Side effects AFTER commit — remove the replaced logo
  if (logoResult && existingBrand.logoPublicId) {
    await deleteFromCloudinary(existingBrand.logoPublicId);
  }

  const diff = buildAuditDiff(
    { ...existingBrand, vehicleTypeIds: previousVehicleTypeIds, logoUrl: existingBrand.logoUrl },
    { ...brandData, vehicleTypeIds: vehicleTypeIds && [...vehicleTypeIds].sort(), logoUrl: logoResult?.secure_url },
  );

  if (diff.changed) {
    await createAuditLog({
      ...actor,
      action: AuditAction.UPDATE,
      entity: "Brand",
      entityId: id,
      oldData: diff.oldData,
      newData: diff.newData,
    });
  }

  return formatBrand(brand);
};

const deleteBrand = async (id: string, actor: TAuditActor) => {
  const brand = await prisma.brand.findUnique({ where: { id } });

  if (!brand) {
    throw new AppError(httpStatus.NOT_FOUND, "Brand not found");
  }

  const [modelCount, listingCount] = await Promise.all([
    prisma.vehicleModel.count({ where: { brandId: id } }),
    prisma.listing.count({ where: { brandId: id } }),
  ]);

  if (listingCount > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot delete brand because ${listingCount} listing(s) use it. Deactivate it instead.`,
    );
  }

  if (modelCount > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot delete brand because ${modelCount} model(s) belong to it. Deactivate it instead.`,
    );
  }

  // BrandVehicleType rows are removed by onDelete: Cascade
  const deletedBrand = await prisma.brand.delete({ where: { id } });

  await deleteFromCloudinary(brand.logoPublicId);

  await createAuditLog({
    ...actor,
    action: AuditAction.DELETE,
    entity: "Brand",
    entityId: id,
    oldData: { name: brand.name, slug: brand.slug },
  });

  return deletedBrand;
};

export const BrandService = {
  createBrand,
  getAllBrands,
  getBrandByIdOrSlug,
  updateBrand,
  deleteBrand,
};
