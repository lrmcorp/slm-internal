-- CreateEnum
CREATE TYPE "WarehouseRequestStatus" AS ENUM ('MENUNGGU', 'SELESAI', 'SEBAGIAN', 'BATAL');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'GUDANG';

-- CreateTable
CREATE TABLE "WarehouseRequest" (
    "id" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" "WarehouseRequestStatus" NOT NULL DEFAULT 'MENUNGGU',
    "notes" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "requestedByName" TEXT NOT NULL,
    "processedByUserId" TEXT,
    "processedByName" TEXT,
    "processedAt" TIMESTAMP(3),
    "processNotes" TEXT,
    "transferId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "requestedQty" DECIMAL(18,2) NOT NULL,
    "fulfilledQty" DECIMAL(18,2),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WarehouseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseRequest_requestNumber_key" ON "WarehouseRequest"("requestNumber");

-- CreateIndex
CREATE INDEX "WarehouseRequest_status_createdAt_idx" ON "WarehouseRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseRequest_requestedByUserId_createdAt_idx" ON "WarehouseRequest"("requestedByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseRequestItem_requestId_idx" ON "WarehouseRequestItem"("requestId");

-- CreateIndex
CREATE INDEX "WarehouseRequestItem_productId_idx" ON "WarehouseRequestItem"("productId");

-- AddForeignKey
ALTER TABLE "WarehouseRequestItem" ADD CONSTRAINT "WarehouseRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "WarehouseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

