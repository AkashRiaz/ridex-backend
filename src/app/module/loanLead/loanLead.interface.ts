import {
  EmploymentType,
  LoanLeadStatus,
} from "../../../generated/prisma/enums";

export interface ICreateLoanLeadPayload {
  listingId: string;
  preferredPartnerId?: string;
  downPayment: number;
  tenureMonths: number;
  interestRate: number;
  fullName: string;
  phone: string;
  email?: string;
  district?: string;
  monthlyIncome?: number;
  employmentType: EmploymentType;
  note?: string;
  consent: true;
}

export interface IAssignLoanLeadPayload {
  partnerId: string;
  note?: string;
}

export interface IUpdateLoanLeadStatusPayload {
  status: LoanLeadStatus;
  note?: string;
  partnerReference?: string;
}

export interface IWithdrawLoanLeadPayload {
  reason?: string;
}

// event payload (appEvents)
export interface ILoanLeadRef {
  loanLeadId: string;
  reference: string;
  buyerId: string;
  listingId: string;
  listingTitle: string;
  listingSlug: string;
  status: LoanLeadStatus;
}

// BullMQ job payload (notification-email queue)
export interface ILoanLeadPartnerEmailJob {
  loanLeadId: string;
  partnerId: string;
}
