import { describe, expect, it } from "vitest";
import {
  ListingStatus,
  ReportTargetType,
  Role,
} from "../src/generated/prisma/enums";
import {
  assertActionAllowed,
  sortByPriority,
  targetColumns,
  targetIdOf,
  targetKey,
} from "../src/app/module/report/report.utils";
import {
  CreateReportZodSchema,
  UpdateReportZodSchema,
} from "../src/app/module/report/report.validation";
import {
  evaluateReviewEligibility,
  isWithinEditWindow,
} from "../src/app/module/review/review.utils";
import { ReviewVisibilityZodSchema } from "../src/app/module/review/review.validation";
import {
  getDocumentProblems,
  isPurgeDue,
  maskNid,
} from "../src/app/module/verification/verification.utils";
import { SubmitVerificationZodSchema } from "../src/app/module/verification/verification.validation";

const image = { mimetype: "image/jpeg" };
const pdf = { mimetype: "application/pdf" };

// ============================================
// Reviews
// ============================================

describe("review eligibility", () => {
  const reviewer = { id: "buyer", emailVerified: true, phoneVerified: false };
  const listing = {
    id: "l1",
    sellerId: "seller",
    status: ListingStatus.APPROVED,
    isDeleted: false,
  };
  const base = {
    reviewer,
    listing,
    hasInteraction: true,
    alreadyReviewed: false,
  };

  it("allows a verified buyer who interacted with the listing", () => {
    expect(evaluateReviewEligibility(base)).toEqual({ allowed: true });
    expect(
      evaluateReviewEligibility({
        ...base,
        listing: { ...listing, status: ListingStatus.SOLD },
      }),
    ).toEqual({
      allowed: true,
    });
  });

  it.each([
    ["own listing", { reviewer: { ...reviewer, id: "seller" } }, "OWN_LISTING"],
    [
      "draft listing",
      { listing: { ...listing, status: ListingStatus.DRAFT } },
      "LISTING_UNAVAILABLE",
    ],
    [
      "deleted listing",
      { listing: { ...listing, isDeleted: true } },
      "LISTING_UNAVAILABLE",
    ],
    [
      "unverified reviewer",
      { reviewer: { ...reviewer, emailVerified: false } },
      "UNVERIFIED",
    ],
    ["second review", { alreadyReviewed: true }, "ALREADY_REVIEWED"],
    ["no interaction", { hasInteraction: false }, "NO_INTERACTION"],
  ])("blocks: %s", (_, override, code) => {
    const result = evaluateReviewEligibility({ ...base, ...override });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe(code);
  });

  it("edit window is 30 days", () => {
    const now = new Date("2026-06-30T00:00:00Z");
    expect(isWithinEditWindow(new Date("2026-06-01T00:00:00Z"), now)).toBe(
      true,
    );
    expect(isWithinEditWindow(new Date("2026-05-30T00:00:00Z"), now)).toBe(
      false,
    );
  });

  it("hiding a review needs a reason", () => {
    expect(
      ReviewVisibilityZodSchema.safeParse({ isHidden: true }).success,
    ).toBe(false);
    expect(
      ReviewVisibilityZodSchema.safeParse({ isHidden: true, reason: "Abusive" })
        .success,
    ).toBe(true);
    expect(
      ReviewVisibilityZodSchema.safeParse({ isHidden: false }).success,
    ).toBe(true);
  });
});

// ============================================
// Reports
// ============================================

describe("report targets", () => {
  it("maps target types to typed columns and back", () => {
    expect(targetColumns(ReportTargetType.LISTING, "x")).toEqual({
      listingId: "x",
    });
    expect(targetColumns(ReportTargetType.USER, "x")).toEqual({
      reportedUserId: "x",
    });
    expect(targetColumns(ReportTargetType.REVIEW, "x")).toEqual({
      reviewId: "x",
    });
    expect(targetIdOf({ reviewId: "r1" })).toBe("r1");
    expect(
      targetKey({ targetType: ReportTargetType.USER, reportedUserId: "u1" }),
    ).toBe("USER:u1");
  });

  it("only allows actions that fit the target, and only admins block users", () => {
    expect(() =>
      assertActionAllowed(
        "TAKE_DOWN_LISTING",
        ReportTargetType.LISTING,
        Role.MODERATOR,
      ),
    ).not.toThrow();
    expect(() =>
      assertActionAllowed("HIDE_REVIEW", ReportTargetType.LISTING, Role.ADMIN),
    ).toThrow(/does not apply/);
    expect(() =>
      assertActionAllowed("BLOCK_USER", ReportTargetType.USER, Role.MODERATOR),
    ).toThrow(/Only admins/);
    expect(() =>
      assertActionAllowed("BLOCK_USER", ReportTargetType.LISTING, Role.ADMIN),
    ).not.toThrow();
    expect(() =>
      assertActionAllowed("NONE", ReportTargetType.REVIEW, Role.MODERATOR),
    ).not.toThrow();
  });

  it("puts the most-reported targets first, oldest first within a target count", () => {
    const at = (minute: number) => new Date(2026, 0, 1, 0, minute);
    const sorted = sortByPriority(
      [
        { id: "a", key: "LISTING:1", createdAt: at(1) },
        { id: "b", key: "USER:9", createdAt: at(2) },
        { id: "c", key: "LISTING:1", createdAt: at(3) },
        { id: "d", key: "REVIEW:5", createdAt: at(0) },
      ],
      new Map([
        ["LISTING:1", 2],
        ["USER:9", 1],
        ["REVIEW:5", 1],
      ]),
    );

    expect(sorted.map((report) => report.id)).toEqual(["a", "c", "d", "b"]);
  });

  it("validates report payloads", () => {
    const uuid = "3f2c1a8e-9b4d-4c6e-8a1f-2b3c4d5e6f70";
    expect(
      CreateReportZodSchema.safeParse({
        targetType: "LISTING",
        targetId: uuid,
        reason: "SCAM",
      }).success,
    ).toBe(true);
    expect(
      CreateReportZodSchema.safeParse({
        targetType: "POST",
        targetId: uuid,
        reason: "SCAM",
      }).success,
    ).toBe(false);
    expect(
      UpdateReportZodSchema.safeParse({ status: "RESOLVED" }).success,
    ).toBe(false);
    expect(
      UpdateReportZodSchema.safeParse({
        status: "IN_REVIEW",
        action: "BLOCK_USER",
      }).success,
    ).toBe(false);
    expect(
      UpdateReportZodSchema.safeParse({
        status: "RESOLVED",
        resolutionNote: "Scam confirmed",
        action: "TAKE_DOWN_LISTING",
      }).success,
    ).toBe(true);
  });
});

// ============================================
// Verification
// ============================================

describe("verification documents", () => {
  it("accepts a complete ID set", () => {
    expect(
      getDocumentProblems(
        "ID",
        ["NID_FRONT", "NID_BACK", "SELFIE"],
        [image, image, image],
      ),
    ).toEqual([]);
  });

  it("reports missing, foreign and duplicate documents", () => {
    const problems = getDocumentProblems(
      "ID",
      ["NID_FRONT", "NID_FRONT", "TRADE_LICENSE"],
      [image, image, image],
    );

    expect(problems.join(" | ")).toMatch(/NID back is required/);
    expect(problems.join(" | ")).toMatch(/Selfie is required/);
    expect(problems.join(" | ")).toMatch(
      /Trade license is not used for id verification/,
    );
    expect(problems.join(" | ")).toMatch(/At most 1 × NID front/);
  });

  it("dealer: PDFs only for licenses, up to 4 showroom photos", () => {
    expect(
      getDocumentProblems(
        "DEALER",
        ["TRADE_LICENSE", "TIN_CERTIFICATE", "SHOWROOM_PHOTO"],
        [pdf, pdf, image],
      ),
    ).toEqual([]);
    expect(
      getDocumentProblems(
        "DEALER",
        ["TRADE_LICENSE", "SHOWROOM_PHOTO"],
        [pdf, pdf],
      ).join(),
    ).toMatch(/Showroom photo must be a photo/);
    expect(
      getDocumentProblems(
        "DEALER",
        ["TRADE_LICENSE", ...Array(5).fill("SHOWROOM_PHOTO")],
        Array(6).fill(image),
      ).join(),
    ).toMatch(/At most 4/);
    expect(
      getDocumentProblems(
        "ID",
        ["NID_FRONT", "NID_BACK", "SELFIE"],
        [pdf, image, image],
      ).join(),
    ).toMatch(/NID front must be a photo/);
  });

  it("needs one document type per file", () => {
    expect(getDocumentProblems("ID", ["NID_FRONT"], [image, image])).toEqual([
      "Each uploaded file needs a document type",
    ]);
  });

  it("stores only the last 4 NID digits", () => {
    expect(maskNid("1234567890123")).toBe("0123");
    expect(maskNid("19912345678901234")).toBe("1234");
  });

  it("purges documents 30 days after a decision", () => {
    const now = new Date("2026-07-31T00:00:00Z");
    expect(isPurgeDue(new Date("2026-07-01T00:00:00Z"), now)).toBe(true);
    expect(isPurgeDue(new Date("2026-07-15T00:00:00Z"), now)).toBe(false);
    expect(isPurgeDue(null, now)).toBe(false);
  });

  it("validates ID and dealer submissions", () => {
    expect(
      SubmitVerificationZodSchema.safeParse({
        type: "ID",
        fullName: "Rahim Uddin",
        nidNumber: "1234567890",
        documentKinds: ["NID_FRONT", "NID_BACK", "SELFIE"],
      }).success,
    ).toBe(true);
    expect(
      SubmitVerificationZodSchema.safeParse({
        type: "ID",
        fullName: "Rahim",
        nidNumber: "12345",
        documentKinds: ["NID_FRONT"],
      }).success,
    ).toBe(false);
    expect(
      SubmitVerificationZodSchema.safeParse({
        type: "DEALER",
        businessName: "Dhaka Moto",
        tradeLicenseNumber: "TRAD/DNCC/123",
        division: "Dhaka",
        district: "Dhaka",
        documentKinds: ["TRADE_LICENSE"],
      }).success,
    ).toBe(true);
    expect(
      SubmitVerificationZodSchema.safeParse({ type: "PASSPORT" }).success,
    ).toBe(false);
  });
});
