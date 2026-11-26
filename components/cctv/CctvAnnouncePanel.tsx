"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/ToastProvider";

type Speaker = { channel: number; name: string };
const MAX_LENGTH = 300;

/** Owner mengetik pengumuman, memilih satu atau beberapa speaker CCTV, lalu mengirimnya. */
export function CctvAnnouncePanel({ speakers: initial }: { speakers: Speaker[] }) {
  const { showToast } = useToast();
  const [speakers, setSpeakers] = useState(initial);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number[]>(() => (initial.some((s) => s.channel === 13) ? [13] : initial.slice(0, 1).map((s) => s.channel)));
  const [sending, setSending] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(initial.map((s) => [s.channel, s.name])));
  const [savingNames, setSavingNames] = useState(false);

  const toggle = (channel: number) =>
    setPicked((current) => (current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel].sort((a, b) => a - b)));
  const allPicked = picked.length === speakers.length;

  async function announce() {
    const message = text.trim();
    if (message.length < 3) return showToast("Tulis pengumuman dulu.", "error");
    if (!picked.length) return showToast("Pilih minimal satu speaker.", "error");
    setSending(true);
    try {
      const res = await fetch("/api/cctv/announce", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message, channels: picked }) });
      const json = await res.json().catch(() => null);
      if (!json?.success) return showToast(json?.message || "Pengumuman gagal dikirim.", "error");
      const label = speakers.filter((s) => picked.includes(s.channel)).map((s) => s.name).join(", ");
      showToast(`Dikirim ke ${label}. Suara keluar dalam beberapa detik.`, "success");
      setText("");
    } finally {
      setSending(false);
    }
  }

  async function saveNames() {
    setSavingNames(true);
    try {
      const body = { speakers: speakers.map((s) => ({ channel: s.channel, name: names[s.channel] ?? s.name })) };
      const res = await fetch("/api/cctv/speakers", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => null);
      if (!json?.success) return showToast(json?.message || "Nama speaker gagal disimpan.", "error");
      setSpeakers(json.data);
      setRenaming(false);
      showToast("Nama speaker disimpan.", "success");
    } finally {
      setSavingNames(false);
    }
  }

  return (
    <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="pengumuman-speaker">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="pengumuman-speaker" className="font-bold text-slate-900">Pengumuman Speaker</h3>
        <button type="button" className="min-h-11 text-sm font-semibold text-slate-700 underline" onClick={() => setRenaming((v) => !v)}>
          {renaming ? "Selesai ubah nama" : "Ubah nama speaker"}
        </button>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Tulis kalimatnya, pilih speaker, lalu kirim. Suara Google membacakannya di tiap speaker secara bergantian.
      </p>

      <label htmlFor="pengumuman-teks" className="mt-3 block text-sm font-semibold text-slate-800">Kalimat</label>
      <Textarea
        id="pengumuman-teks"
        rows={3}
        maxLength={MAX_LENGTH}
        value={text}
        placeholder="mis. Mohon perhatian, toko akan tutup 15 menit lagi."
        onChange={(event) => setText(event.target.value)}
        className="mt-1"
      />
      <p className="mt-1 text-right text-xs text-slate-500">{text.length}/{MAX_LENGTH}</p>

      <fieldset className="mt-2">
        <legend className="text-sm font-semibold text-slate-800">Speaker</legend>
        <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {speakers.map((speaker) =>
            renaming ? (
              <label key={speaker.channel} className="flex min-h-11 items-center gap-2 text-sm">
                <span className="w-16 shrink-0 text-slate-500">Kanal {speaker.channel}</span>
                <Input
                  aria-label={`Nama speaker kanal ${speaker.channel}`}
                  value={names[speaker.channel] ?? ""}
                  maxLength={60}
                  onChange={(event) => setNames((current) => ({ ...current, [speaker.channel]: event.target.value }))}
                />
              </label>
            ) : (
              <label key={speaker.channel} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-slate-800 hover:bg-slate-50">
                <input type="checkbox" className="h-5 w-5" checked={picked.includes(speaker.channel)} onChange={() => toggle(speaker.channel)} />
                {speaker.name}
              </label>
            )
          )}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {renaming ? (
          <Button className="min-h-11" onClick={saveNames} disabled={savingNames}>{savingNames ? "Menyimpan..." : "Simpan nama"}</Button>
        ) : (
          <>
            <Button className="min-h-11" onClick={announce} disabled={sending}>{sending ? "Mengirim..." : "Umumkan"}</Button>
            <Button className="min-h-11" variant="secondary" onClick={() => setPicked(allPicked ? [] : speakers.map((s) => s.channel))}>
              {allPicked ? "Kosongkan pilihan" : "Pilih semua speaker"}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
