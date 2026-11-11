import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { InventoryError } from "./errors";

/** Ubah error menjadi respons JSON dengan pesan yang bisa dibaca pengguna. */
export function warehouseRequestError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ success: false, message: error.issues[0]?.message || "Data tidak valid." }, { status: 400 });
  if (error instanceof InventoryError) return NextResponse.json({ success: false, message: error.message, code: error.code }, { status: error.status });
  console.error("[gudang] permintaan barang gagal:", error);
  return NextResponse.json({ success: false, message: "Permintaan barang gagal diproses. Coba lagi." }, { status: 500 });
}
