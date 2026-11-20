import { DocumentKind, VerificationType } from "../../../generated/prisma/enums";

export interface ISubmitIdVerificationPayload {
  type: "ID";
  fullName: string;
  nidNumber: string;
  // one entry per uploaded file, same order as the `documents` files
  documentKinds: DocumentKind[];
}

export interface ISubmitDealerVerificationPayload {
  type: "DEALER";
  businessName: string;
  tradeLicenseNumber: string;
  division: string;
  district: string;
  area?: string;
  documentKinds: DocumentKind[];
}

export type TSubmitVerificationPayload = ISubmitIdVerificationPayload | ISubmitDealerVerificationPayload;

export interface IReviewVerificationPayload {
  status: "APPROVED" | "REJECTED";
  reason?: string;
}

export type TDocumentRule = {
  required: DocumentKind[];
  allowed: DocumentKind[];
  // kinds that may appear more than once, with their maximum
  repeatable: Partial<Record<DocumentKind, number>>;
  // kinds that may be PDFs (the rest must be images)
  pdfAllowed: DocumentKind[];
};

export type TVerificationRules = Record<VerificationType, TDocumentRule>;
