import {
  DocumentKind,
  VerificationType,
} from "../../../generated/prisma/enums";
import { TVerificationRules } from "./verification.interface";

export const DOCUMENT_PURGE_AFTER_DAYS = 30;

export const VERIFICATION_RULES: TVerificationRules = {
  ID: {
    required: [
      DocumentKind.NID_FRONT,
      DocumentKind.NID_BACK,
      DocumentKind.SELFIE,
    ],
    allowed: [
      DocumentKind.NID_FRONT,
      DocumentKind.NID_BACK,
      DocumentKind.SELFIE,
    ],
    repeatable: {},
    pdfAllowed: [],
  },
  DEALER: {
    required: [DocumentKind.TRADE_LICENSE],
    allowed: [
      DocumentKind.TRADE_LICENSE,
      DocumentKind.TIN_CERTIFICATE,
      DocumentKind.SHOWROOM_PHOTO,
    ],
    repeatable: { [DocumentKind.SHOWROOM_PHOTO]: 4 },
    pdfAllowed: [DocumentKind.TRADE_LICENSE, DocumentKind.TIN_CERTIFICATE],
  },
};

type TFileLike = { mimetype: string };

/*
 * Every problem with the uploaded document set, as readable messages.
 * `kinds[i]` describes `files[i]`.
 */
export const getDocumentProblems = (
  type: VerificationType,
  kinds: DocumentKind[],
  files: TFileLike[],
) => {
  const rule = VERIFICATION_RULES[type];
  const problems: string[] = [];

  if (kinds.length !== files.length) {
    problems.push("Each uploaded file needs a document type");
    return problems;
  }

  for (const kind of kinds) {
    if (!rule.allowed.includes(kind)) {
      problems.push(
        `${label(kind)} is not used for ${type.toLowerCase()} verification`,
      );
    }
  }

  for (const kind of rule.required) {
    if (!kinds.includes(kind)) problems.push(`${label(kind)} is required`);
  }

  for (const kind of new Set(kinds)) {
    const count = kinds.filter((item) => item === kind).length;
    const max = rule.repeatable[kind] ?? 1;
    if (count > max) problems.push(`At most ${max} × ${label(kind)}`);
  }

  kinds.forEach((kind, index) => {
    const mimetype = files[index].mimetype;
    const isImage = mimetype.startsWith("image/");
    const isPdf = mimetype === "application/pdf";

    if (!isImage && !(isPdf && rule.pdfAllowed.includes(kind))) {
      problems.push(
        `${label(kind)} must be ${rule.pdfAllowed.includes(kind) ? "an image or PDF" : "a photo"}`,
      );
    }
  });

  return Array.from(new Set(problems));
};

const label = (kind: DocumentKind) =>
  kind
    .toLowerCase()
    .split("_")
    .map((word) =>
      word === "nid" || word === "tin" ? word.toUpperCase() : word,
    )
    .join(" ")
    .replace(/^./, (character) => character.toUpperCase());

export const documentLabel = label;

// only the last 4 digits ever leave this function
export const maskNid = (nidNumber: string) =>
  nidNumber.replace(/\D/g, "").slice(-4);

export const isPurgeDue = (reviewedAt: Date | null, now = new Date()) =>
  Boolean(reviewedAt) &&
  now.getTime() - (reviewedAt as Date).getTime() >=
    DOCUMENT_PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
