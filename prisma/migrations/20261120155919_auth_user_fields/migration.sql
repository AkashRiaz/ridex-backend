-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "area" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dateOfBirth" TIMESTAMP(3),
ADD COLUMN     "district" TEXT,
ADD COLUMN     "division" TEXT,
ADD COLUMN     "gender" "Gender";

-- CreateIndex
CREATE INDEX "users_isDeleted_idx" ON "users"("isDeleted");
