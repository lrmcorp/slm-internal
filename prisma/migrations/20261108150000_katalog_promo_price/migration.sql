-- Harga promo khusus Katalog Online (sebelum markup MJ). Hanya menambah kolom nullable.
ALTER TABLE "InventoryProduct" ADD COLUMN "katalogPromoPrice" DECIMAL(18,2);
