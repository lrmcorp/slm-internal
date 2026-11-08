"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toast } from "@/components/ui/Toast";

type Option = { id: string; name: string; bankName: string | null; accountNumber: string | null };
type Setting = { rekeningId: string; accountHolder: string; options: Option[] };

export function KatalogPaymentForm({ initial }: { initial: Setting }) {
  const [rekeningId, setRekeningId] = useState(initial.rekeningId);
  const [accountHolder, setAccountHolder] = useState(initial.accountHolder);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string }>();

  const save = async () => {
    setSaving(true);
    const response = await fetch("/api/settings/katalog-payment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rekeningId, accountHolder }) });
    const result = await response.json().catch(() => null);
    setNotice(response.ok && result?.success
      ? { type: "success", message: rekeningId ? "Rekening katalog disimpan. Pesanan baru memakai rekening ini." : "Rekening katalog dikosongkan." }
      : { type: "error", message: result?.message || "Gagal menyimpan." });
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      {notice && <Toast {...notice} />}
      <section className="aj-surface max-w-xl space-y-4 p-5 sm:p-6">
        <p className="text-sm text-slate-600">Pelanggan Katalog Online mentransfer ke rekening ini, dengan kode unik 3 angka di belakang nominal supaya mudah dicocokkan dengan mutasi.</p>
        <label className="block text-sm font-semibold text-slate-700">
          Rekening tujuan
          <Select className="mt-1" value={rekeningId} onChange={(event) => setRekeningId(event.target.value)}>
            <option value="">Belum dipilih</option>
            {initial.options.map((option) => (
              <option key={option.id} value={option.id}>{[option.bankName, option.accountNumber, option.name].filter(Boolean).join(" · ")}</option>
            ))}
          </Select>
        </label>
        <label className="block text-sm font-semibold text-slate-700">
          Atas nama (pemilik rekening)
          <Input className="mt-1" value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} placeholder="Nama sesuai buku tabungan" maxLength={80} />
        </label>
        {initial.options.length === 0 && <p className="text-sm text-amber-700">Belum ada rekening aktif dengan nomor rekening. Tambahkan dulu di Pengaturan, Rekening.</p>}
        <Button type="button" onClick={save} disabled={saving}>{saving ? "Menyimpan..." : "Simpan"}</Button>
      </section>
    </div>
  );
}
