"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { RupiahInput } from "@/components/ui/RupiahInput";
import { useToast } from "@/components/ui/ToastProvider";

type TypeOption = { value: string; label: string; from: boolean; to: boolean; fromHint?: string; toHint?: string };
type RekeningOption = { id: string; label: string };
/** Mutasi yang sedang diubah. */
export type CashBankEditing = { id: string; journalNumber: string; type: string; date: string; fromRekeningId: string | null; toRekeningId: string | null; amount: number; notes: string | null };

const field = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function CashBankForm({ types, rekenings, today, editing }: { types: TypeOption[]; rekenings: RekeningOption[]; today: string; editing?: CashBankEditing }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [type, setType] = useState(editing?.type ?? types[0]?.value ?? "");
  const [date, setDate] = useState(editing?.date ?? today);
  const [from, setFrom] = useState(editing?.fromRekeningId ?? "");
  const [to, setTo] = useState(editing?.toRekeningId ?? "");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const t = types.find((x) => x.value === type);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!(Number(amount) > 0)) return showToast("Isi nominal lebih dari 0.", "error");
    setBusy(true);
    try {
      const res = await fetch(editing ? `/api/cash-bank/${editing.id}` : "/api/cash-bank", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, date, amount: Number(amount), notes: notes || undefined, fromRekeningId: t?.from ? from : undefined, toRekeningId: t?.to ? to : undefined })
      });
      const json = await res.json();
      if (!json.success) return showToast(json.message || "Gagal menyimpan.", "error");
      if (editing) {
        showToast(`Mutasi ${json.data.journalNumber} diubah.`, "success");
        router.push("/kas-bank");
        router.refresh();
        return;
      }
      showToast(`Tersimpan sebagai jurnal ${json.data.journalNumber}.`, "success");
      setAmount("");
      setNotes("");
      router.refresh();
    } catch {
      showToast("Koneksi terputus. Coba lagi.", "error");
    } finally {
      setBusy(false);
    }
  }

  const select = (label: string, value: string, onChange: (v: string) => void, name: string) => (
    <label className="space-y-1 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <select name={name} className={field} value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Pilih rekening</option>
        {rekenings.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </label>
  );

  return (
    <form onSubmit={save} className="aj-surface space-y-4 p-4 sm:p-5">
      {editing && <p className="text-sm font-semibold text-slate-900">Ubah mutasi {editing.journalNumber} <span className="font-normal text-slate-600">· nomor jurnal tetap, perubahan tercatat di Audit Trail</span></p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Jenis</span>
          <select className={field} value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Tanggal</span>
          <input type="date" className={field} value={date} max={today} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Nominal</span>
          <RupiahInput className="w-full" value={amount} onChange={setAmount} placeholder="0" ariaLabel="Nominal" />
        </label>
        {t?.from && select(t.fromHint ?? "Dari rekening", from, setFrom, "fromRekeningId")}
        {t?.to && select(t.toHint ?? "Ke rekening", to, setTo, "toRekeningId")}
        <label className="space-y-1 text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-1">
          <span>Keterangan <span className="font-normal text-slate-500">(opsional)</span></span>
          <input className={field} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="mis. setoran hasil penjualan Senin" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="min-h-11 px-5" disabled={busy}>{busy ? "Menyimpan..." : editing ? "Simpan Perubahan" : "Simpan Mutasi"}</Button>
        {editing && <Link href="/kas-bank" className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-600 underline">Batal</Link>}
      </div>
    </form>
  );
}
