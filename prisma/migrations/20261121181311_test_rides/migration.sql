-- CreateEnum
CREATE TYPE "TestRideStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'EXPIRED');

-- AlterEnum
ALTER TYPE "MessageType" ADD VALUE 'TEST_RIDE';

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'TEST_RIDES';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'TEST_RIDE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'TEST_RIDE_CONFIRMED';
ALTER TYPE "NotificationType" ADD VALUE 'TEST_RIDE_DECLINED';
ALTER TYPE "NotificationType" ADD VALUE 'TEST_RIDE_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'TEST_RIDE_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'TEST_RIDE_REMINDER';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "testRideId" TEXT;

-- CreateTable
CREATE TABLE "test_rides" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "TestRideStatus" NOT NULL DEFAULT 'REQUESTED',
    "buyerNote" TEXT NOT NULL DEFAULT '',
    "sellerNote" TEXT NOT NULL DEFAULT '',
    "declineReason" TEXT,
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_ride_availabilities" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "listingId" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 30,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_ride_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_ride_blocked_dates" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_ride_blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_rides_sellerId_startsAt_idx" ON "test_rides"("sellerId", "startsAt");

-- CreateIndex
CREATE INDEX "test_rides_buyerId_startsAt_idx" ON "test_rides"("buyerId", "startsAt");

-- CreateIndex
CREATE INDEX "test_rides_listingId_status_idx" ON "test_rides"("listingId", "status");

-- CreateIndex
CREATE INDEX "test_rides_status_startsAt_idx" ON "test_rides"("status", "startsAt");

-- CreateIndex
CREATE INDEX "test_ride_availabilities_sellerId_dayOfWeek_idx" ON "test_ride_availabilities"("sellerId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "test_ride_availabilities_listingId_idx" ON "test_ride_availabilities"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "test_ride_blocked_dates_sellerId_date_key" ON "test_ride_blocked_dates"("sellerId", "date");

-- CreateIndex
CREATE INDEX "messages_testRideId_idx" ON "messages"("testRideId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_testRideId_fkey" FOREIGN KEY ("testRideId") REFERENCES "test_rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_rides" ADD CONSTRAINT "test_rides_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_rides" ADD CONSTRAINT "test_rides_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_rides" ADD CONSTRAINT "test_rides_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_rides" ADD CONSTRAINT "test_rides_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_ride_availabilities" ADD CONSTRAINT "test_ride_availabilities_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_ride_availabilities" ADD CONSTRAINT "test_ride_availabilities_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_ride_blocked_dates" ADD CONSTRAINT "test_ride_blocked_dates_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
