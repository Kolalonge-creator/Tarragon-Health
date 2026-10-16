"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { t } from "@tarragon/i18n";

/**
 * A person's own label, note and date on one record item (S44, spec 2.14). It changes nothing about the item: a device reading the person
 * cannot edit can still carry a note. Notes are private to the person (never exported or shared). For an item that looks wrong, the person asks
 * their care team for a correction; they do not edit or delete a clinician's or a device's entry.
 */
const ITEM_TABLES = new Set([
  "vitals_readings", "lab_results", "lab_analyte_readings", "medications", "patient_conditions", "patient_allergies",
  "vaccination_records", "symptoms", "patient_documents", "procedures", "family_history", "external_records",
]);

export function canAnnotate(table: string | null | undefined, id: string | null | undefined): boolean {
  return Boolean(table && id && ITEM_TABLES.has(table));
}

interface NoteRow { item_table: string; item_id: string; label: string | null; note: string | null; patient_date: string | null }

function useNotes() {
  return useQuery({
    queryKey: ["item-notes"],
    staleTime: 60_000,
    queryFn: async (): Promise<NoteRow[]> => {
      const { data, error } = await createClient().rpc("my_item_notes", {});
      if (error) throw error;
      return (data ?? []) as NoteRow[];
    },
  });
}

export function ItemNote({ table, id }: { table: string; id: string }) {
  const qc = useQueryClient();
  const notes = useNotes();
  const current = notes.data?.find((n) => n.item_table === table && n.item_id === id);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [wrong, setWrong] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("set_item_note", { p_table: table, p_id: id, p_label: label, p_note: note, p_date: date || undefined });
      if (error) throw error;
    },
    onSuccess: () => { setOpen(false); setStatus(t("itemnote.saved")); void qc.invalidateQueries({ queryKey: ["item-notes"] }); },
    onError: () => setStatus(t("itemnote.failed")),
  });
  const ask = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("request_item_correction", { p_table: table, p_id: id, p_what_is_wrong: wrong });
      if (error) throw error;
    },
    onSuccess: () => { setAsking(false); setWrong(""); setStatus(t("itemnote.correction_sent")); },
    onError: () => setStatus(t("itemnote.failed")),
  });

  return (
    <div className="mt-1 space-y-1 text-xs">
      {current ? (
        <p className="text-charcoal-ink/70 dark:text-night-ink/70">
          {current.label ? <span className="mr-2 rounded-full bg-charcoal-ink/10 px-2 py-0.5 font-medium dark:bg-night-ink/15">{current.label}</span> : null}
          {current.note}
          {current.patient_date ? ` (${t("itemnote.your_date")}: ${current.patient_date})` : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="underline" onClick={() => { setLabel(current?.label ?? ""); setNote(current?.note ?? ""); setDate(current?.patient_date ?? ""); setOpen((v) => !v); }}>
          {current ? t("itemnote.edit") : t("itemnote.add")}
        </button>
        <button type="button" className="underline" onClick={() => setAsking((v) => !v)}>{t("itemnote.ask_correction")}</button>
      </div>
      {open ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <p className="text-charcoal-ink/60 dark:text-night-ink/60">{t("itemnote.private")}</p>
          <input aria-label={t("itemnote.label")} placeholder={t("itemnote.label")} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} className="block w-full rounded border border-charcoal-ink/20 bg-transparent px-2 py-1 dark:border-night-ink/30" />
          <textarea aria-label={t("itemnote.note")} placeholder={t("itemnote.note")} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="block w-full rounded border border-charcoal-ink/20 bg-transparent px-2 py-1 dark:border-night-ink/30" />
          <label className="block">{t("itemnote.your_date")} <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-charcoal-ink/20 bg-transparent px-2 py-1 dark:border-night-ink/30" /></label>
          <Button type="submit" size="sm" disabled={save.isPending}>{t("itemnote.save")}</Button>
        </form>
      ) : null}
      {asking ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); ask.mutate(); }}>
          <p className="text-charcoal-ink/60 dark:text-night-ink/60">{t("itemnote.correction_help")}</p>
          <textarea aria-label={t("itemnote.what_is_wrong")} placeholder={t("itemnote.what_is_wrong")} required minLength={3} maxLength={2000} value={wrong} onChange={(e) => setWrong(e.target.value)} className="block w-full rounded border border-charcoal-ink/20 bg-transparent px-2 py-1 dark:border-night-ink/30" />
          <Button type="submit" size="sm" disabled={ask.isPending || wrong.trim().length < 3}>{t("itemnote.send_correction")}</Button>
        </form>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}
