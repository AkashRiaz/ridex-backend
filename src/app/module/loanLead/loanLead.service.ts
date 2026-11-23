import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import { AuditAction, LoanLeadStatus } from "../../../generated/prisma/enums";
import { LoanLeadWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { formatPrice } from "../../helper/formatPrice";
import { isUuid } from "../../helper/isUuid";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { QUEUE_NAMES, enqueueJob } from "../../lib/queue";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog, TAuditActor } from "../../utils/auditLogger";
import { sendEmail } from "../../utils/sendEmail";
import { toPartnerNumbers } from "../financePartner/financePartner.utils";
import {
  IAssignLoanLeadPayload,
  ICreateLoanLeadPayload,
  ILoanLeadPartnerEmailJob,
  ILoanLeadRef,
  IUpdateLoanLeadStatusPayload,
  IWithdrawLoanLeadPayload,
} from "./loanLead.interface";
import {
  ASSIGNABLE_LOAN_LEAD_STATUSES,
  LOAN_LEAD_ADMIN_ROLES,
  OPEN_LOAN_LEAD_STATUSES,
  TERMINAL_LOAN_LEAD_STATUSES,
  WITHDRAWABLE_LOAN_LEAD_STATUSES,
  buildLoanTerms,
  canTransitionLoanLead,
  evaluateLoanLeadCreate,
  evaluateLoanTerms,
  loanLeadReference,
  statusTimestampField,
} from "./loanLead.utils";

// ============================================
// Shapes
// ============================================

const partnerCardSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  interestRateMin: true,
  interestRateMax: true,
  minDownPaymentPercent: true,
  maxTenureMonths: true,
} satisfies Prisma.FinancePartnerSelect;

const loanLeadInclude = {
  listing: {
    select: {
      id: true,
      title: true,
      slug: true,
      price: true,
      status: true,
      isDeleted: true,
      district: true,
      area: true,
      images: { where: { isCover: true }, take: 1, select: { url: true } },
    },
  },
  buyer: {
    select: { id: true, name: true, email: true, phone: true, imageUrl: true },
  },
  partner: {
    select: { ...partnerCardSelect, contactEmail: true, contactPhone: true },
  },
  preferredPartner: { select: partnerCardSelect },
} satisfies Prisma.LoanLeadInclude;

type TLoanLeadRow = Prisma.LoanLeadGetPayload<{
  include: typeof loanLeadInclude;
}>;

type TView = "buyer" | "admin";

const toPartnerCard = (
  partner: TLoanLeadRow["preferredPartner"] | TLoanLeadRow["partner"],
) =>
  partner
    ? {
        ...toPartnerNumbers({
          id: partner.id,
          name: partner.name,
          slug: partner.slug,
          logoUrl: partner.logoUrl,
          interestRateMin: partner.interestRateMin,
          interestRateMax: partner.interestRateMax,
          minDownPaymentPercent: partner.minDownPaymentPercent,
          maxTenureMonths: partner.maxTenureMonths,
        }),
      }
    : null;

/*
 * One shape for both sides; the buyer never sees the admin note,
 * the partner's contact details or their own account fields.
 */
const toLoanLead = (lead: TLoanLeadRow, view: TView) => {
  const loanAmount = Number(lead.loanAmount);
  const estimatedEmi = Number(lead.estimatedEmi);
  const totalPayable = Math.round(estimatedEmi * lead.tenureMonths * 100) / 100;

  return {
    id: lead.id,
    reference: loanLeadReference(lead.id),
    status: lead.status,
    listingId: lead.listingId,
    buyerId: lead.buyerId,
    listingPrice: Number(lead.listingPrice),
    downPayment: Number(lead.downPayment),
    loanAmount,
    tenureMonths: lead.tenureMonths,
    interestRate: Number(lead.interestRate),
    estimatedEmi,
    totalPayable,
    totalInterest:
      Math.round(Math.max(0, totalPayable - loanAmount) * 100) / 100,
    fullName: lead.fullName,
    phone: lead.phone,
    email: lead.email,
    district: lead.district,
    monthlyIncome:
      lead.monthlyIncome === null ? null : Number(lead.monthlyIncome),
    employmentType: lead.employmentType,
    note: lead.note,
    consentAt: lead.consentAt,
    partnerReference: lead.partnerReference,
    closeReason: lead.closeReason,
    sentAt: lead.sentAt,
    contactedAt: lead.contactedAt,
    approvedAt: lead.approvedAt,
    disbursedAt: lead.disbursedAt,
    closedAt: lead.closedAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    canWithdraw:
      view === "buyer" && WITHDRAWABLE_LOAN_LEAD_STATUSES.includes(lead.status),
    listing: {
      id: lead.listing.id,
      title: lead.listing.title,
      slug: lead.listing.slug,
      price: Number(lead.listing.price),
      status: lead.listing.status,
      isDeleted: lead.listing.isDeleted,
      district: lead.listing.district,
      area: lead.listing.area,
      coverImage: lead.listing.images[0]?.url ?? null,
    },
    preferredPartner: toPartnerCard(lead.preferredPartner),
    partner: toPartnerCard(lead.partner),
    ...(view === "admin" && {
      adminNote: lead.adminNote,
      buyer: lead.buyer,
      partnerContact: lead.partner
        ? {
            contactEmail: lead.partner.contactEmail,
            contactPhone: lead.partner.contactPhone,
          }
        : null,
    }),
  };
};

const toLoanLeadRef = (lead: TLoanLeadRow): ILoanLeadRef => ({
  loanLeadId: lead.id,
  reference: loanLeadReference(lead.id),
  buyerId: lead.buyerId,
  listingId: lead.listingId,
  listingTitle: lead.listing.title,
  listingSlug: lead.listing.slug,
  status: lead.status,
});

// ============================================
// Helpers
// ============================================

const RULE_STATUS: Record<string, number> = {
  LISTING_NOT_FOUND: httpStatus.NOT_FOUND,
  OWN_LISTING: httpStatus.BAD_REQUEST,
  LISTING_NOT_LIVE: httpStatus.BAD_REQUEST,
  DUPLICATE: httpStatus.CONFLICT,
  LIMIT_REACHED: httpStatus.CONFLICT,
};

const throwRule = (result: { code: string; reason: string }): never => {
  throw new AppError(
    RULE_STATUS[result.code] ?? httpStatus.BAD_REQUEST,
    result.reason,
  );
};

const isAdmin = (user: RequestUser) =>
  LOAN_LEAD_ADMIN_ROLES.includes(user.role);

const findLoanLead = async (id: string) => {
  const lead = isUuid(id)
    ? await prisma.loanLead.findUnique({
        where: { id },
        include: loanLeadInclude,
      })
    : null;

  if (!lead) {
    throw new AppError(httpStatus.NOT_FOUND, "Financing request not found");
  }

  return lead;
};

/*
 * Status-guarded write: if another admin (or the buyer) changed the lead
 * meanwhile, nothing is written and the caller gets a 409.
 */
const guardedUpdate = async (
  id: string,
  expectedStatus: LoanLeadStatus,
  data: Prisma.LoanLeadUncheckedUpdateManyInput,
) => {
  const { count } = await prisma.loanLead.updateMany({
    where: { id, status: expectedStatus },
    data,
  });

  if (count === 0) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This financing request was just updated. Refresh and try again.",
    );
  }

  return prisma.loanLead.findUniqueOrThrow({
    where: { id },
    include: loanLeadInclude,
  });
};

const parseStatusFilter = (
  value: unknown,
): LoanLeadWhereInput["status"] | undefined => {
  if (value === "OPEN") return { in: OPEN_LOAN_LEAD_STATUSES };
  if (value === "CLOSED_ALL") return { in: TERMINAL_LOAN_LEAD_STATUSES };

  if (
    typeof value === "string" &&
    (Object.values(LoanLeadStatus) as string[]).includes(value)
  ) {
    return value as LoanLeadStatus;
  }

  return undefined;
};

const parseDate = (value: unknown, endOfDay = false) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);

  return date;
};

const enqueuePartnerEmail = (loanLeadId: string, partnerId: string) =>
  enqueueJob<ILoanLeadPartnerEmailJob>(
    QUEUE_NAMES.notificationEmail,
    "loan-lead-partner",
    { loanLeadId, partnerId },
  );

// ============================================
// Buyer
// ============================================

const createLoanLead = async (
  user: RequestUser,
  payload: ICreateLoanLeadPayload,
) => {
  const listing = await prisma.listing.findUnique({
    where: { id: payload.listingId },
    select: {
      id: true,
      status: true,
      isDeleted: true,
      sellerId: true,
      price: true,
    },
  });

  const preferredPartner = payload.preferredPartnerId
    ? await prisma.financePartner.findFirst({
        where: { id: payload.preferredPartnerId, isActive: true },
      })
    : null;

  if (payload.preferredPartnerId && !preferredPartner) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "That finance partner is not available",
    );
  }

  const listingPrice = Number(listing?.price ?? 0);

  const lead = await prisma.$transaction(async (tx) => {
    // one buyer at a time: the open-lead checks below cannot race
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loan-lead:${user.userId}`}::text))`;

    const openLeads = await tx.loanLead.findMany({
      where: { buyerId: user.userId, status: { in: OPEN_LOAN_LEAD_STATUSES } },
      select: { listingId: true },
    });

    const createRule = evaluateLoanLeadCreate({
      listing,
      buyerId: user.userId,
      hasOpenLeadForListing: openLeads.some(
        (open) => open.listingId === payload.listingId,
      ),
      openLeadCount: openLeads.length,
      maxOpen: config.loan_lead_max_open,
    });

    if (!createRule.allowed) throwRule(createRule);

    const termsRule = evaluateLoanTerms({
      listingPrice,
      downPayment: payload.downPayment,
      tenureMonths: payload.tenureMonths,
      interestRate: payload.interestRate,
      minDownPaymentPercent: config.loan_min_down_payment_percent,
      partner: preferredPartner
        ? {
            name: preferredPartner.name,
            interestRateMin: Number(preferredPartner.interestRateMin),
            interestRateMax: Number(preferredPartner.interestRateMax),
            minDownPaymentPercent: preferredPartner.minDownPaymentPercent,
            maxTenureMonths: preferredPartner.maxTenureMonths,
          }
        : null,
    });

    if (!termsRule.allowed) throwRule(termsRule);

    const terms = buildLoanTerms({
      listingPrice,
      downPayment: payload.downPayment,
      tenureMonths: payload.tenureMonths,
      interestRate: payload.interestRate,
    });

    return tx.loanLead.create({
      data: {
        listingId: payload.listingId,
        buyerId: user.userId,
        preferredPartnerId: preferredPartner?.id ?? null,
        listingPrice,
        downPayment: payload.downPayment,
        loanAmount: terms.loanAmount,
        tenureMonths: payload.tenureMonths,
        interestRate: payload.interestRate,
        estimatedEmi: terms.estimatedEmi,
        fullName: payload.fullName,
        phone: payload.phone,
        email: payload.email ?? user.email ?? null,
        district: payload.district || null,
        monthlyIncome: payload.monthlyIncome ?? null,
        employmentType: payload.employmentType,
        note: payload.note ?? "",
        consentAt: new Date(),
      },
      include: loanLeadInclude,
    });
  });

  // Side effects AFTER commit
  appEvents.emit("loanLead.submitted", {
    ...toLoanLeadRef(lead),
    fullName: lead.fullName,
    loanAmount: Number(lead.loanAmount),
  });

  return toLoanLead(lead, "buyer");
};

const getMyLoanLeads = async (user: RequestUser, query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 10);

  const andConditions: LoanLeadWhereInput[] = [{ buyerId: user.userId }];

  const status = parseStatusFilter(query.status);
  if (status) andConditions.push({ status });

  if (query.listingId && isUuid(query.listingId)) {
    andConditions.push({ listingId: query.listingId });
  }

  const where = { AND: andConditions };

  const [leads, total] = await Promise.all([
    prisma.loanLead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      include: loanLeadInclude,
    }),
    prisma.loanLead.count({ where }),
  ]);

  return {
    data: leads.map((lead) => toLoanLead(lead, "buyer")),
    meta: queryBuilder.buildMeta(page, limit, total),
  };
};

const getLoanLeadById = async (user: RequestUser, id: string) => {
  const lead = await findLoanLead(id);

  if (isAdmin(user)) return toLoanLead(lead, "admin");

  // same 404 for "missing" and "not yours"
  if (lead.buyerId !== user.userId) {
    throw new AppError(httpStatus.NOT_FOUND, "Financing request not found");
  }

  return toLoanLead(lead, "buyer");
};

const withdrawLoanLead = async (
  user: RequestUser,
  id: string,
  payload: IWithdrawLoanLeadPayload,
) => {
  const lead = await findLoanLead(id);

  if (lead.buyerId !== user.userId) {
    throw new AppError(httpStatus.NOT_FOUND, "Financing request not found");
  }

  if (!WITHDRAWABLE_LOAN_LEAD_STATUSES.includes(lead.status)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This request can no longer be withdrawn. Contact support if you changed your mind.",
    );
  }

  const updated = await guardedUpdate(id, lead.status, {
    status: LoanLeadStatus.WITHDRAWN,
    closedAt: new Date(),
    closeReason: payload.reason || "Withdrawn by you",
  });

  appEvents.emit("loanLead.withdrawn", {
    ...toLoanLeadRef(updated),
    previousStatus: lead.status,
    partnerName: lead.partner?.name ?? null,
  });

  return toLoanLead(updated, "buyer");
};

// ============================================
// Admin
// ============================================

const getLoanLeads = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const orderBy = queryBuilder.buildSort(
    query,
    ["createdAt", "updatedAt", "loanAmount", "listingPrice"],
    "createdAt",
  );

  const andConditions: LoanLeadWhereInput[] = [];

  const searchCondition = queryBuilder.buildSearch(query.searchTerm, [
    "fullName",
    "phone",
    "email",
    "listing.title",
  ]);

  if (searchCondition) {
    andConditions.push(searchCondition as LoanLeadWhereInput);
  }

  const status = parseStatusFilter(query.status);
  if (status) andConditions.push({ status });

  if (query.partnerId === "none") {
    andConditions.push({ partnerId: null });
  } else if (query.partnerId && isUuid(query.partnerId)) {
    andConditions.push({ partnerId: query.partnerId });
  }

  if (query.listingId && isUuid(query.listingId)) {
    andConditions.push({ listingId: query.listingId });
  }

  const from = parseDate(query.fromDate);
  const to = parseDate(query.toDate, true);

  if (from || to) {
    andConditions.push({
      createdAt: { ...(from && { gte: from }), ...(to && { lt: to }) },
    });
  }

  const where = { AND: andConditions };

  const [leads, total, statusGroups] = await Promise.all([
    prisma.loanLead.findMany({
      where,
      orderBy,
      take: limit,
      skip,
      include: loanLeadInclude,
    }),
    prisma.loanLead.count({ where }),
    // counts for the status tabs (whole queue, other filters ignored)
    prisma.loanLead.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(
    Object.values(LoanLeadStatus).map((value) => [
      value,
      statusGroups.find((group) => group.status === value)?._count._all ?? 0,
    ]),
  ) as Record<LoanLeadStatus, number>;

  return {
    data: leads.map((lead) => toLoanLead(lead, "admin")),
    meta: { ...queryBuilder.buildMeta(page, limit, total), statusCounts },
  };
};

const assignLoanLead = async (
  actor: TAuditActor,
  id: string,
  payload: IAssignLoanLeadPayload,
) => {
  const lead = await findLoanLead(id);

  if (!ASSIGNABLE_LOAN_LEAD_STATUSES.includes(lead.status)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Only new requests, or requests a partner has not picked up yet, can be sent",
    );
  }

  if (lead.partnerId === payload.partnerId) {
    throw new AppError(
      httpStatus.CONFLICT,
      "This request was already sent to that partner",
    );
  }

  const partner = await prisma.financePartner.findUnique({
    where: { id: payload.partnerId },
  });

  if (!partner?.isActive) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "That finance partner is not available",
    );
  }

  const updated = await guardedUpdate(id, lead.status, {
    partnerId: partner.id,
    status: LoanLeadStatus.SENT_TO_PARTNER,
    sentAt: new Date(),
    ...(payload.note && { adminNote: payload.note }),
  });

  // Side effects AFTER commit
  await createAuditLog({
    ...actor,
    action: AuditAction.UPDATE,
    entity: "LoanLead",
    entityId: id,
    oldData: { status: lead.status, partnerId: lead.partnerId },
    newData: { status: updated.status, partnerId: partner.id },
  });

  await enqueuePartnerEmail(id, partner.id);

  appEvents.emit("loanLead.sentToPartner", {
    ...toLoanLeadRef(updated),
    partnerId: partner.id,
    partnerName: partner.name,
    isResend: lead.status === LoanLeadStatus.SENT_TO_PARTNER,
  });

  return toLoanLead(updated, "admin");
};

const updateLoanLeadStatus = async (
  actor: TAuditActor,
  id: string,
  payload: IUpdateLoanLeadStatusPayload,
) => {
  const lead = await findLoanLead(id);

  if (!canTransitionLoanLead(lead.status, payload.status)) {
    throw new AppError(
      httpStatus.CONFLICT,
      lead.status === LoanLeadStatus.NEW
        ? "Send this request to a partner first, or close it"
        : `A ${lead.status.toLowerCase().replace(/_/g, " ")} request cannot move to ${payload.status.toLowerCase()}`,
    );
  }

  const now = new Date();
  const timestampField = statusTimestampField(payload.status);
  const isTerminal = TERMINAL_LOAN_LEAD_STATUSES.includes(payload.status);
  const isClosing =
    payload.status === LoanLeadStatus.REJECTED ||
    payload.status === LoanLeadStatus.CLOSED;

  const updated = await guardedUpdate(id, lead.status, {
    status: payload.status,
    ...(timestampField && { [timestampField]: now }),
    ...(isTerminal && { closedAt: now }),
    ...(isClosing && { closeReason: payload.note }),
    ...(payload.note && { adminNote: payload.note }),
    ...(payload.partnerReference !== undefined && {
      partnerReference: payload.partnerReference || null,
    }),
  });

  await createAuditLog({
    ...actor,
    action: AuditAction.UPDATE,
    entity: "LoanLead",
    entityId: id,
    oldData: {
      status: lead.status,
      partnerReference: lead.partnerReference,
    },
    newData: {
      status: updated.status,
      partnerReference: updated.partnerReference,
      note: payload.note ?? null,
    },
  });

  appEvents.emit("loanLead.statusChanged", {
    ...toLoanLeadRef(updated),
    previousStatus: lead.status,
    closeReason: updated.closeReason,
    partnerName: updated.partner?.name ?? null,
  });

  return toLoanLead(updated, "admin");
};

// ============================================
// System
// ============================================

/*
 * The listing is gone: requests no partner has seen yet are closed.
 * Requests already with a partner stay open (the partner may still call).
 */
const closeNewLoanLeadsForListing = async (
  listingId: string,
  reason: string,
) => {
  const leads = await prisma.loanLead.findMany({
    where: { listingId, status: LoanLeadStatus.NEW },
    include: loanLeadInclude,
  });

  if (!leads.length) return 0;

  const closeReason = `Listing no longer available: ${reason}`;
  const now = new Date();

  await prisma.loanLead.updateMany({
    where: {
      id: { in: leads.map((lead) => lead.id) },
      status: LoanLeadStatus.NEW,
    },
    data: { status: LoanLeadStatus.CLOSED, closedAt: now, closeReason },
  });

  for (const lead of leads) {
    appEvents.emit("loanLead.statusChanged", {
      ...toLoanLeadRef(lead),
      status: LoanLeadStatus.CLOSED,
      previousStatus: LoanLeadStatus.NEW,
      closeReason,
      partnerName: null,
    });
  }

  return leads.length;
};

/*
 * notification-email job: the lead goes to the partner's contact address.
 * Re-checked when the job runs, so a withdrawn or re-assigned lead is
 * never sent.
 */
const sendLeadToPartnerEmail = async (data: ILoanLeadPartnerEmailJob) => {
  const lead = await prisma.loanLead.findUnique({
    where: { id: data.loanLeadId },
    include: loanLeadInclude,
  });

  if (
    !lead ||
    lead.partnerId !== data.partnerId ||
    lead.status !== LoanLeadStatus.SENT_TO_PARTNER ||
    !lead.partner
  ) {
    return "skipped: lead changed";
  }

  const reference = loanLeadReference(lead.id);

  await sendEmail({
    to: lead.partner.contactEmail,
    subject: `New financing lead ${reference}: ${lead.listing.title}`,
    template: "loan-lead-partner",
    data: {
      partnerName: lead.partner.name,
      reference,
      applicant: {
        name: lead.fullName,
        phone: lead.phone,
        email: lead.email,
        district: lead.district,
        employment: lead.employmentType.toLowerCase().replace(/_/g, " "),
        monthlyIncome:
          lead.monthlyIncome === null
            ? null
            : formatPrice(Number(lead.monthlyIncome)),
        note: lead.note,
      },
      vehicle: {
        title: lead.listing.title,
        location: [lead.listing.area, lead.listing.district]
          .filter(Boolean)
          .join(", "),
        url: `${config.frontend_url}/listings/${lead.listing.slug}`,
      },
      terms: {
        price: formatPrice(Number(lead.listingPrice)),
        downPayment: formatPrice(Number(lead.downPayment)),
        loanAmount: formatPrice(Number(lead.loanAmount)),
        tenureMonths: lead.tenureMonths,
        interestRate: Number(lead.interestRate),
        estimatedEmi: formatPrice(Number(lead.estimatedEmi)),
      },
      adminNote: lead.adminNote,
      consentAt: lead.consentAt.toISOString().slice(0, 10),
    },
  });

  return "sent";
};

export const LoanLeadService = {
  createLoanLead,
  getMyLoanLeads,
  getLoanLeadById,
  withdrawLoanLead,
  getLoanLeads,
  assignLoanLead,
  updateLoanLeadStatus,
  closeNewLoanLeadsForListing,
  sendLeadToPartnerEmail,
};
