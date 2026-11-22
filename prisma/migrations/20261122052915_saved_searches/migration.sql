-- CreateEnum
CREATE TYPE "SavedSearchAlertFrequency" AS ENUM ('INSTANT', 'DAILY', 'OFF');

-- CreateEnum
CREATE TYPE "SavedSearchMatchKind" AS ENUM ('NEW_LISTING', 'PRICE_DROP');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SAVED_SEARCH_MATCH';
ALTER TYPE "NotificationType" ADD VALUE 'SAVED_SEARCH_PRICE_DROP';

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "queryHash" TEXT NOT NULL,
    "vehicleTypeId" TEXT,
    "alertFrequency" "SavedSearchAlertFrequency" NOT NULL DEFAULT 'INSTANT',
    "notifyPriceDrops" BOOLEAN NOT NULL DEFAULT true,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAlertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_search_matches" (
    "id" TEXT NOT NULL,
    "savedSearchId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "kind" "SavedSearchMatchKind" NOT NULL,
    "oldPrice" DECIMAL(12,2),
    "newPrice" DECIMAL(12,2),
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_search_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_searches_vehicleTypeId_idx" ON "saved_searches"("vehicleTypeId");

-- CreateIndex
CREATE INDEX "saved_searches_alertFrequency_idx" ON "saved_searches"("alertFrequency");

-- CreateIndex
CREATE UNIQUE INDEX "saved_searches_userId_queryHash_key" ON "saved_searches"("userId", "queryHash");

-- CreateIndex
CREATE INDEX "saved_search_matches_savedSearchId_matchedAt_idx" ON "saved_search_matches"("savedSearchId", "matchedAt");

-- CreateIndex
CREATE INDEX "saved_search_matches_listingId_idx" ON "saved_search_matches"("listingId");

-- CreateIndex
CREATE INDEX "saved_search_matches_notifiedAt_idx" ON "saved_search_matches"("notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "saved_search_matches_savedSearchId_listingId_kind_key" ON "saved_search_matches"("savedSearchId", "listingId", "kind");

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search_matches" ADD CONSTRAINT "saved_search_matches_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "saved_searches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search_matches" ADD CONSTRAINT "saved_search_matches_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
