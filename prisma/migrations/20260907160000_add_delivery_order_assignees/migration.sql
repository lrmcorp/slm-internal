-- Tabel ini dipakai schema.prisma (model DeliveryOrderAssignee) dan fitur penugasan DO,
-- tetapi tidak pernah dibuat oleh migrasi di repo ini (di database lama dibuat manual).
-- Semua perintah IF NOT EXISTS: tidak mengubah database yang sudah punya tabel ini.
CREATE TABLE IF NOT EXISTS "DeliveryOrderAssignee" (
    "id" TEXT NOT NULL,
    "deliveryOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "assignedByNameSnapshot" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryOrderAssignee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryOrderAssignee_deliveryOrderId_userId_key" ON "DeliveryOrderAssignee"("deliveryOrderId", "userId");
CREATE INDEX IF NOT EXISTS "DeliveryOrderAssignee_deliveryOrderId_idx" ON "DeliveryOrderAssignee"("deliveryOrderId");
CREATE INDEX IF NOT EXISTS "DeliveryOrderAssignee_userId_idx" ON "DeliveryOrderAssignee"("userId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryOrderAssignee_deliveryOrderId_fkey') THEN
    ALTER TABLE "DeliveryOrderAssignee" ADD CONSTRAINT "DeliveryOrderAssignee_deliveryOrderId_fkey" FOREIGN KEY ("deliveryOrderId") REFERENCES "DeliveryOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
