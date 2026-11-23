-- CreateEnum
CREATE TYPE "LoanLeadStatus" AS ENUM ('NEW', 'SENT_TO_PARTNER', 'CONTACTED', 'APPROVED', 'DISBURSED', 'REJECTED', 'WITHDRAWN', 'CLOSED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('SALARIED', 'SELF_EMPLOYED', 'BUSINESS', 'STUDENT', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'FINANCING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'LOAN_LEAD_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'LOAN_LEAD_UPDATED';

-- CreateTable
CREATE TABLE "finance_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "website" TEXT,
    "interestRateMin" DECIMAL(5,2) NOT NULL,
    "interestRateMax" DECIMAL(5,2) NOT NULL,
    "minDownPaymentPercent" INTEGER NOT NULL,
    "maxTenureMonths" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_leads" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "preferredPartnerId" TEXT,
    "partnerId" TEXT,
    "listingPrice" DECIMAL(12,2) NOT NULL,
    "downPayment" DECIMAL(12,2) NOT NULL,
    "loanAmount" DECIMAL(12,2) NOT NULL,
    "tenureMonths" INTEGER NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "estimatedEmi" DECIMAL(12,2) NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "district" TEXT,
    "monthlyIncome" DECIMAL(12,2),
    "employmentType" "EmploymentType" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "consentAt" TIMESTAMP(3) NOT NULL,
    "status" "LoanLeadStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "partnerReference" TEXT,
    "closeReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "contactedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "disbursedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_partners_name_key" ON "finance_partners"("name");

-- CreateIndex
CREATE UNIQUE INDEX "finance_partners_slug_key" ON "finance_partners"("slug");

-- CreateIndex
CREATE INDEX "finance_partners_isActive_idx" ON "finance_partners"("isActive");

-- CreateIndex
CREATE INDEX "loan_leads_status_createdAt_idx" ON "loan_leads"("status", "createdAt");

-- CreateIndex
CREATE INDEX "loan_leads_buyerId_status_idx" ON "loan_leads"("buyerId", "status");

-- CreateIndex
CREATE INDEX "loan_leads_listingId_status_idx" ON "loan_leads"("listingId", "status");

-- CreateIndex
CREATE INDEX "loan_leads_partnerId_idx" ON "loan_leads"("partnerId");

-- CreateIndex
CREATE INDEX "loan_leads_preferredPartnerId_idx" ON "loan_leads"("preferredPartnerId");

-- AddForeignKey
ALTER TABLE "loan_leads" ADD CONSTRAINT "loan_leads_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_leads" ADD CONSTRAINT "loan_leads_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_leads" ADD CONSTRAINT "loan_leads_preferredPartnerId_fkey" FOREIGN KEY ("preferredPartnerId") REFERENCES "finance_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_leads" ADD CONSTRAINT "loan_leads_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "finance_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
