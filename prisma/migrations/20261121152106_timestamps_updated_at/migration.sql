/*
  Convention A8: every model has createdAt + updatedAt (AuditLog only createdAt).
  Existing rows get updatedAt = createdAt; the temporary default is then dropped,
  because Prisma sets @updatedAt itself.
*/

-- AlterTable
ALTER TABLE "brand_vehicle_types" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "brand_vehicle_types" SET "updatedAt" = "createdAt";
ALTER TABLE "brand_vehicle_types" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "listing_images" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "listing_images" SET "updatedAt" = "createdAt";
ALTER TABLE "listing_images" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "messages" SET "updatedAt" = "createdAt";
ALTER TABLE "messages" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "notifications" SET "updatedAt" = "createdAt";
ALTER TABLE "notifications" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "refresh_tokens" SET "updatedAt" = "createdAt";
ALTER TABLE "refresh_tokens" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "user_blocks" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "user_blocks" SET "updatedAt" = "createdAt";
ALTER TABLE "user_blocks" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "verification_documents" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "verification_documents" SET "updatedAt" = "createdAt";
ALTER TABLE "verification_documents" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "wishlist_items" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "wishlist_items" SET "updatedAt" = "createdAt";
ALTER TABLE "wishlist_items" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: recently_viewed had only viewedAt
ALTER TABLE "recently_viewed" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "recently_viewed" SET "createdAt" = "viewedAt", "updatedAt" = "viewedAt";
ALTER TABLE "recently_viewed" ALTER COLUMN "updatedAt" DROP DEFAULT;
