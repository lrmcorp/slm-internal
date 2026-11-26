-- Barang baru dari Input Penjualan menunggu persetujuan Owner sebelum masuk Master Barang.
-- Barang yang sudah ada otomatis "approved".
ALTER TABLE "InventoryProduct" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "InventoryProduct" ADD COLUMN "requestedByName" TEXT;
ALTER TABLE "InventoryProduct" ADD COLUMN "requestedAt" TIMESTAMP(3);
ALTER TABLE "InventoryProduct" ADD COLUMN "approvalDecidedBy" TEXT;
ALTER TABLE "InventoryProduct" ADD COLUMN "approvalDecidedAt" TIMESTAMP(3);
CREATE INDEX "InventoryProduct_approvalStatus_idx" ON "InventoryProduct"("approvalStatus");
