-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "country" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "logoPublicId" TEXT,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_vehicle_types" (
    "brandId" TEXT NOT NULL,
    "vehicleTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_vehicle_types_pkey" PRIMARY KEY ("brandId","vehicleTypeId")
);

-- CreateTable
CREATE TABLE "vehicle_models" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "vehicleTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "defaultSpecs" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key" ON "brands"("name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_isActive_idx" ON "brands"("isActive");

-- CreateIndex
CREATE INDEX "brands_isPopular_idx" ON "brands"("isPopular");

-- CreateIndex
CREATE INDEX "brand_vehicle_types_vehicleTypeId_idx" ON "brand_vehicle_types"("vehicleTypeId");

-- CreateIndex
CREATE INDEX "vehicle_models_brandId_idx" ON "vehicle_models"("brandId");

-- CreateIndex
CREATE INDEX "vehicle_models_vehicleTypeId_idx" ON "vehicle_models"("vehicleTypeId");

-- CreateIndex
CREATE INDEX "vehicle_models_isActive_idx" ON "vehicle_models"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_brandId_name_key" ON "vehicle_models"("brandId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_models_brandId_slug_key" ON "vehicle_models"("brandId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_name_key" ON "vehicle_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_slug_key" ON "vehicle_types"("slug");

-- CreateIndex
CREATE INDEX "vehicle_types_isActive_idx" ON "vehicle_types"("isActive");

-- CreateIndex
CREATE INDEX "vehicle_types_sortOrder_idx" ON "vehicle_types"("sortOrder");

-- AddForeignKey
ALTER TABLE "brand_vehicle_types" ADD CONSTRAINT "brand_vehicle_types_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_vehicle_types" ADD CONSTRAINT "brand_vehicle_types_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
