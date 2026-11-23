export interface ICreateFinancePartnerPayload {
  name: string;
  slug?: string;
  description?: string;
  contactEmail: string;
  contactPhone?: string;
  website?: string;
  interestRateMin: number;
  interestRateMax: number;
  minDownPaymentPercent: number;
  maxTenureMonths: number;
  isActive?: boolean;
}

export interface IUpdateFinancePartnerPayload {
  name?: string;
  slug?: string;
  description?: string | null;
  contactEmail?: string;
  contactPhone?: string | null;
  website?: string | null;
  interestRateMin?: number;
  interestRateMax?: number;
  minDownPaymentPercent?: number;
  maxTenureMonths?: number;
  isActive?: boolean;
}
