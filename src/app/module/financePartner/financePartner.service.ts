import httpStatus from "http-status";
import { AuditAction } from "../../../generated/prisma/enums";
import { FinancePartnerWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { generateUniqueSlug } from "../../helper/generateSlug";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
  buildAuditDiff,
  createAuditLog,
  TAuditActor,
} from "../../utils/auditLogger";
import {
  deleteFromCloudinary,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import { OPEN_LOAN_LEAD_STATUSES } from "../loanLead/loanLead.utils";
import {
  ICreateFinancePartnerPayload,
  IUpdateFinancePartnerPayload,
} from "./financePartner.interface";
import {
  isRateRangeValid,
  publicFinancePartnerSelect,
  toPartnerNumbers,
} from "./financePartner.utils";

const financePartnerInclude = {
  _count: { select: { loanLeads: true } },
};

const uploadLogo = async (logo: Express.Multer.File | null) => {
  if (!logo) return null;

  if (!logo.mimetype.startsWith("image/")) {
    throw new AppError(
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
      "Logo must be an image file",
    );
  }

  return uploadToCloudinary(logo, {
    folder: `${config.app_name.toLowerCase()}/finance-partners`,
  });
};

const assertNameAndSlugAvailable = async (
  name: string | undefined,
  slug: string | undefined,
  excludeId?: string,
) => {
  if (!name && !slug) return;

  const existing = await prisma.financePartner.findFirst({
    where: {
      OR: [
        ...(name
          ? [{ name: { equals: name, mode: "insensitive" as const } }]
          : []),
        ...(slug ? [{ slug }] : []),
      ],
      ...(excludeId && { NOT: { id: excludeId } }),
    },
  });

  if (existing) {
    throw new AppError(
      httpStatus.CONFLICT,
      "A finance partner with this name or slug already exists",
    );
  }
};

/*
 * Open leads per partner, for the admin table.
 */
const countOpenLeads = async (partnerIds: string[]) => {
  if (!partnerIds.length) return new Map<string, number>();

  const groups = await prisma.loanLead.groupBy({
    by: ["partnerId"],
    where: {
      partnerId: { in: partnerIds },
      status: { in: OPEN_LOAN_LEAD_STATUSES },
    },
    _count: { _all: true },
  });

  return new Map(
    groups.map((group) => [group.partnerId as string, group._count._all]),
  );
};

const auditFields = (partner: {
  name: string;
  slug: string;
  contactEmail: string;
  interestRateMin: unknown;
  interestRateMax: unknown;
  minDownPaymentPercent: number;
  maxTenureMonths: number;
  isActive: boolean;
}) => ({
  name: partner.name,
  slug: partner.slug,
  contactEmail: partner.contactEmail,
  interestRateMin: Number(partner.interestRateMin),
  interestRateMax: Number(partner.interestRateMax),
  minDownPaymentPercent: partner.minDownPaymentPercent,
  maxTenureMonths: partner.maxTenureMonths,
  isActive: partner.isActive,
});

// ============================================
// Public
// ============================================

/*
 * Active partners for the EMI calculator (no contact details).
 */
const getActiveFinancePartners = async () => {
  const partners = await prisma.financePartner.findMany({
    where: { isActive: true },
    orderBy: [{ interestRateMin: "asc" }, { name: "asc" }],
    select: publicFinancePartnerSelect,
  });

  return {
    partners: partners.map(toPartnerNumbers),
    defaults: {
      interestRate: config.loan_default_interest_rate,
      minDownPaymentPercent: config.loan_min_down_payment_percent,
    },
  };
};

// ============================================
// Admin
// ============================================

const createFinancePartner = async (
  payload: ICreateFinancePartnerPayload,
  logo: Express.Multer.File | null,
  actor: TAuditActor,
) => {
  await assertNameAndSlugAvailable(payload.name, payload.slug);

  const slug =
    payload.slug ??
    (await generateUniqueSlug(payload.name, async (candidate) =>
      Boolean(
        await prisma.financePartner.findUnique({ where: { slug: candidate } }),
      ),
    ));

  const logoResult = await uploadLogo(logo);

  const partner = await prisma.financePartner.create({
    data: {
      ...payload,
      slug,
      ...(logoResult && {
        logoUrl: logoResult.secure_url,
        logoPublicId: logoResult.public_id,
      }),
    },
    include: financePartnerInclude,
  });

  await createAuditLog({
    ...actor,
    action: AuditAction.CREATE,
    entity: "FinancePartner",
    entityId: partner.id,
    newData: auditFields(partner),
  });

  return { ...toPartnerNumbers(partner), openLeadsCount: 0 };
};

const getAllFinancePartners = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const orderBy = queryBuilder.buildSort(
    { sortBy: "name", sortOrder: "asc", ...query },
    ["name", "interestRateMin", "createdAt", "updatedAt"],
    "name",
  );

  const andConditions: FinancePartnerWhereInput[] = [];

  const searchCondition = queryBuilder.buildSearch(query.searchTerm, [
    "name",
    "slug",
    "contactEmail",
  ]);

  if (searchCondition) {
    andConditions.push(searchCondition as FinancePartnerWhereInput);
  }

  if (query.isActive === "true" || query.isActive === "false") {
    andConditions.push({ isActive: query.isActive === "true" });
  }

  const partners = await prisma.financePartner.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy,
    include: financePartnerInclude,
  });

  const total = await prisma.financePartner.count({
    where: { AND: andConditions },
  });

  const openLeads = await countOpenLeads(partners.map((partner) => partner.id));

  return {
    data: partners.map((partner) => ({
      ...toPartnerNumbers(partner),
      openLeadsCount: openLeads.get(partner.id) ?? 0,
    })),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getFinancePartnerById = async (id: string) => {
  const partner = await prisma.financePartner.findUnique({
    where: { id },
    include: financePartnerInclude,
  });

  if (!partner) {
    throw new AppError(httpStatus.NOT_FOUND, "Finance partner not found");
  }

  const openLeads = await countOpenLeads([id]);

  return {
    ...toPartnerNumbers(partner),
    openLeadsCount: openLeads.get(id) ?? 0,
  };
};

const updateFinancePartner = async (
  id: string,
  payload: IUpdateFinancePartnerPayload,
  logo: Express.Multer.File | null,
  actor: TAuditActor,
) => {
  const existing = await prisma.financePartner.findUnique({ where: { id } });

  if (!existing) {
    throw new AppError(httpStatus.NOT_FOUND, "Finance partner not found");
  }

  if (
    !isRateRangeValid(
      {
        interestRateMin: Number(existing.interestRateMin),
        interestRateMax: Number(existing.interestRateMax),
      },
      payload,
    )
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "The lowest rate cannot be higher than the highest rate",
    );
  }

  await assertNameAndSlugAvailable(payload.name, payload.slug, id);

  const logoResult = await uploadLogo(logo);

  const partner = await prisma.financePartner.update({
    where: { id },
    data: {
      ...payload,
      ...(logoResult && {
        logoUrl: logoResult.secure_url,
        logoPublicId: logoResult.public_id,
      }),
    },
    include: financePartnerInclude,
  });

  // Side effects AFTER commit — remove the replaced logo
  if (logoResult && existing.logoPublicId) {
    await deleteFromCloudinary(existing.logoPublicId);
  }

  const diff = buildAuditDiff(
    { ...auditFields(existing), logoUrl: existing.logoUrl },
    {
      ...payload,
      logoUrl: logoResult?.secure_url,
    },
  );

  if (diff.changed) {
    await createAuditLog({
      ...actor,
      action: AuditAction.UPDATE,
      entity: "FinancePartner",
      entityId: id,
      oldData: diff.oldData,
      newData: diff.newData,
    });
  }

  const openLeads = await countOpenLeads([id]);

  return {
    ...toPartnerNumbers(partner),
    openLeadsCount: openLeads.get(id) ?? 0,
  };
};

const deleteFinancePartner = async (id: string, actor: TAuditActor) => {
  const partner = await prisma.financePartner.findUnique({ where: { id } });

  if (!partner) {
    throw new AppError(httpStatus.NOT_FOUND, "Finance partner not found");
  }

  const leadCount = await prisma.loanLead.count({
    where: { OR: [{ partnerId: id }, { preferredPartnerId: id }] },
  });

  if (leadCount > 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Cannot delete this partner because ${leadCount} loan lead(s) refer to it. Deactivate it instead.`,
    );
  }

  const deleted = await prisma.financePartner.delete({ where: { id } });

  await deleteFromCloudinary(partner.logoPublicId);

  await createAuditLog({
    ...actor,
    action: AuditAction.DELETE,
    entity: "FinancePartner",
    entityId: id,
    oldData: { name: partner.name, slug: partner.slug },
  });

  return toPartnerNumbers(deleted);
};

export const FinancePartnerService = {
  getActiveFinancePartners,
  createFinancePartner,
  getAllFinancePartners,
  getFinancePartnerById,
  updateFinancePartner,
  deleteFinancePartner,
};
