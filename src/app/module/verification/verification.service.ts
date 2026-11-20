import httpStatus from "http-status";
import { Prisma } from "../../../generated/prisma/client";
import {
  AuditAction,
  Role,
  UserStatus,
  VerificationStatus,
  VerificationType,
} from "../../../generated/prisma/enums";
import { VerificationRequestWhereInput } from "../../../generated/prisma/models";
import { config } from "../../config";
import { appEvents } from "../../events/appEvents";
import { isValidLocation } from "../../helper/bdLocations";
import { queryBuilder } from "../../helper/queryBuilder";
import { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createAuditLog } from "../../utils/auditLogger";
import {
  TUploadResult,
  deleteFromCloudinary,
  getPrivateDownloadUrl,
  uploadToCloudinary,
} from "../../utils/uploadToCloudinary";
import { IRequestMeta } from "../auth/auth.interface";
import { IReviewVerificationPayload, TSubmitVerificationPayload } from "./verification.interface";
import { DOCUMENT_PURGE_AFTER_DAYS, getDocumentProblems, maskNid } from "./verification.utils";

const SIGNED_URL_SECONDS = 10 * 60;

const requestListSelect = {
  id: true,
  type: true,
  status: true,
  details: true,
  rejectionReason: true,
  reviewedAt: true,
  documentsPurgedAt: true,
  createdAt: true,
  documents: { select: { id: true, kind: true, format: true, bytes: true } },
} satisfies Prisma.VerificationRequestSelect;

// ============================================
// Self-service
// ============================================

const getMyVerification = async (userId: string) => {
  const [user, requests] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        role: true,
        status: true,
        phone: true,
        phoneVerified: true,
        email: true,
        emailVerified: true,
        idVerifiedAt: true,
        dealerVerifiedAt: true,
      },
    }),
    prisma.verificationRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: requestListSelect,
    }),
  ]);

  const latest = (type: VerificationType) => requests.find((request) => request.type === type) ?? null;

  return {
    badges: {
      phone: { verified: user.phoneVerified, phone: user.phone },
      email: { verified: user.emailVerified },
      id: { verified: Boolean(user.idVerifiedAt), verifiedAt: user.idVerifiedAt, latestRequest: latest("ID") },
      dealer: {
        applicable: user.role === Role.DEALER,
        verified: Boolean(user.dealerVerifiedAt),
        verifiedAt: user.dealerVerifiedAt,
        latestRequest: latest("DEALER"),
      },
    },
    accountStatus: user.status,
    requests,
  };
};

const submitVerification = async (
  requestUser: RequestUser,
  payload: TSubmitVerificationPayload,
  files: Express.Multer.File[],
) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: requestUser.userId } });

  if (payload.type === VerificationType.DEALER && user.role !== Role.DEALER) {
    throw new AppError(httpStatus.FORBIDDEN, "Only dealer accounts can apply for dealer verification");
  }

  if (payload.type === VerificationType.ID && user.idVerifiedAt) {
    throw new AppError(httpStatus.CONFLICT, "Your ID is already verified");
  }

  if (payload.type === VerificationType.DEALER && user.dealerVerifiedAt) {
    throw new AppError(httpStatus.CONFLICT, "Your dealership is already verified");
  }

  const pending = await prisma.verificationRequest.findFirst({
    where: { userId: user.id, type: payload.type, status: VerificationStatus.PENDING },
    select: { id: true },
  });

  if (pending) {
    throw new AppError(httpStatus.CONFLICT, "You already have a request waiting for review");
  }

  if (payload.type === VerificationType.DEALER && !isValidLocation(payload.division, payload.district)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Choose a valid division and district for the showroom");
  }

  const problems = getDocumentProblems(payload.type, payload.documentKinds, files);

  if (problems.length > 0) {
    throw new AppError(httpStatus.BAD_REQUEST, problems.join("; "));
  }

  // private uploads, all-or-nothing
  const uploads = await Promise.allSettled(
    files.map((file) =>
      uploadToCloudinary(file, {
        type: "private",
        folder: `${config.app_name.toLowerCase()}/verification/${user.id}`,
      }),
    ),
  );

  const uploaded = uploads
    .filter((result): result is PromiseFulfilledResult<TUploadResult> => result.status === "fulfilled")
    .map((result) => result.value);

  if (uploaded.length !== files.length) {
    await Promise.all(
      uploaded.map((item) =>
        deleteFromCloudinary(item.public_id, { type: "private", resourceType: item.resource_type }),
      ),
    );
    throw new AppError(httpStatus.BAD_GATEWAY, "Document upload failed. Please try again.");
  }

  const details =
    payload.type === VerificationType.ID
      ? { fullName: payload.fullName, nidLast4: maskNid(payload.nidNumber) }
      : {
          businessName: payload.businessName,
          tradeLicenseNumber: payload.tradeLicenseNumber,
          division: payload.division,
          district: payload.district,
          area: payload.area ?? null,
        };

  const request = await prisma.verificationRequest.create({
    data: {
      userId: user.id,
      type: payload.type,
      details: details as Prisma.InputJsonValue,
      documents: {
        create: uploaded.map((item, index) => ({
          kind: payload.documentKinds[index],
          publicId: item.public_id,
          resourceType: item.resource_type,
          format: item.format,
          bytes: item.bytes,
        })),
      },
    },
    select: requestListSelect,
  });

  appEvents.emit("verification.submitted", { requestId: request.id, userId: user.id, type: request.type });

  return request;
};

// ============================================
// Admin review
// ============================================

const getVerificationRequests = async (query: IQuery) => {
  const { page, limit, skip } = queryBuilder.buildPagination(query, 20);

  const andConditions: VerificationRequestWhereInput[] = [];

  if (query.status && Object.values(VerificationStatus).includes(query.status)) {
    andConditions.push({ status: query.status });
  } else if (query.status !== "ALL") {
    andConditions.push({ status: VerificationStatus.PENDING });
  }

  if (query.type && Object.values(VerificationType).includes(query.type)) {
    andConditions.push({ type: query.type });
  }

  if (query.searchTerm) {
    andConditions.push({
      user: {
        OR: [
          { name: { contains: query.searchTerm, mode: "insensitive" } },
          { email: { contains: query.searchTerm, mode: "insensitive" } },
        ],
      },
    });
  }

  const where = { AND: andConditions };

  const [requests, total, statusCounts] = await Promise.all([
    prisma.verificationRequest.findMany({
      where,
      // first come, first served
      orderBy: { createdAt: query.sortOrder === "desc" ? "desc" : "asc" },
      take: limit,
      skip,
      select: {
        ...requestListSelect,
        user: {
          select: { id: true, name: true, email: true, phone: true, role: true, status: true, imageUrl: true },
        },
      },
    }),
    prisma.verificationRequest.count({ where }),
    prisma.verificationRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return {
    data: requests,
    meta: {
      ...queryBuilder.buildMeta(page, limit, total),
      statusCounts: Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all])),
    },
  };
};

/*
 * Detail with short-lived signed links to the private documents.
 */
const getVerificationRequestById = async (id: string) => {
  const request = await prisma.verificationRequest.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          phoneVerified: true,
          role: true,
          status: true,
          imageUrl: true,
          createdAt: true,
          idVerifiedAt: true,
          dealerVerifiedAt: true,
        },
      },
      documents: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!request) {
    throw new AppError(httpStatus.NOT_FOUND, "Verification request not found");
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_SECONDS * 1000);

  return {
    ...request,
    documents: request.documents.map(({ publicId, resourceType, format, ...document }) => ({
      ...document,
      format,
      // purged documents have no file any more
      url: request.documentsPurgedAt
        ? null
        : getPrivateDownloadUrl(publicId, format, resourceType, SIGNED_URL_SECONDS),
    })),
    documentUrlsExpireAt: request.documentsPurgedAt ? null : expiresAt,
  };
};

const reviewVerificationRequest = async (
  staff: RequestUser,
  id: string,
  payload: IReviewVerificationPayload,
  meta: IRequestMeta,
) => {
  const request = await prisma.verificationRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, status: true } } },
  });

  if (!request) {
    throw new AppError(httpStatus.NOT_FOUND, "Verification request not found");
  }

  if (request.status !== VerificationStatus.PENDING) {
    throw new AppError(httpStatus.CONFLICT, "This request has already been reviewed");
  }

  if (request.userId === staff.userId) {
    throw new AppError(httpStatus.FORBIDDEN, "You cannot review your own verification");
  }

  const isApprove = payload.status === VerificationStatus.APPROVED;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.verificationRequest.update({
      where: { id },
      data: {
        status: payload.status,
        rejectionReason: isApprove ? null : (payload.reason ?? null),
        reviewedById: staff.userId,
        reviewedAt: now,
      },
    });

    if (isApprove) {
      await tx.user.update({
        where: { id: request.userId },
        data:
          request.type === VerificationType.ID
            ? { idVerifiedAt: now }
            : {
                dealerVerifiedAt: now,
                // a verified dealer can start posting listings
                ...(request.user.status === UserStatus.PENDING && { status: UserStatus.ACTIVE }),
              },
      });
    }

    await createAuditLog(
      {
        userId: staff.userId,
        action: isApprove ? AuditAction.APPROVE : AuditAction.REJECT,
        entity: "VerificationRequest",
        entityId: id,
        newData: { type: request.type, status: payload.status, reason: payload.reason ?? null },
        ...meta,
      },
      tx,
    );
  });

  // Side effects AFTER commit
  if (isApprove) {
    appEvents.emit("verification.approved", { requestId: id, userId: request.userId, type: request.type });
  } else {
    appEvents.emit("verification.rejected", {
      requestId: id,
      userId: request.userId,
      type: request.type,
      reason: payload.reason ?? "",
    });
  }

  return getVerificationRequestById(id);
};

// ============================================
// Cron
// ============================================

/*
 * Deletes document files DOCUMENT_PURGE_AFTER_DAYS after a decision.
 * The request (type, decision, masked details) is kept as a record.
 */
const purgeReviewedDocuments = async () => {
  const cutoff = new Date(Date.now() - DOCUMENT_PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const requests = await prisma.verificationRequest.findMany({
    where: {
      status: { in: [VerificationStatus.APPROVED, VerificationStatus.REJECTED] },
      reviewedAt: { lt: cutoff },
      documentsPurgedAt: null,
    },
    include: { documents: true },
    take: 200,
  });

  for (const request of requests) {
    await Promise.all(
      request.documents.map((document) =>
        deleteFromCloudinary(document.publicId, { type: "private", resourceType: document.resourceType }),
      ),
    );

    await prisma.verificationRequest.update({
      where: { id: request.id },
      data: { documentsPurgedAt: new Date() },
    });
  }

  return requests.length;
};

export const VerificationService = {
  getMyVerification,
  submitVerification,
  getVerificationRequests,
  getVerificationRequestById,
  reviewVerificationRequest,
  purgeReviewedDocuments,
};
