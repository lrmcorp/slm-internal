-- Kolom ini sudah dipakai schema.prisma dan migrasi 20261105050000_customer_directory,
-- tetapi tidak pernah dibuat oleh migrasi mana pun (di database lama ditambahkan manual).
-- IF NOT EXISTS: aman untuk database yang sudah punya kolom ini.
ALTER TABLE "SalesRecord" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
