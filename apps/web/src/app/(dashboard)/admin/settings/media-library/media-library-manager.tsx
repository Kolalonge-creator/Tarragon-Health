"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface MediaRow {
  id: string; code: string; kind: string; exercise_type: string | null; title: string; summary: string | null; series: string; series_position: number;
  language: string; voice: string | null; duration_seconds: number | null; bytes: number | null; audio_url: string | null; content_status: string;
  is_placeholder: boolean; is_active: boolean; reviewed_by_name: string | null; reviewed_at: string | null; next_review_due: string | null;
  script: { narration?: string; steps?: { text: string }[]; voice_note?: string | null; sources?: string[]; estimated_minutes?: number; needs_clinical_review?: boolean } | null;
  faith_leader_reviewer_name: string | null; faith_leader_reviewer_role: string | null; faith_leader_reviewed_at: string | null;
}

const field = "w-full rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1 text-sm";

export function MediaLibraryManager({ rows, report }: { rows: MediaRow[]; report: { servable: number; placeholders: number; draft: number; expired: number } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function flag() {
    const { data, error } = await createClient().rpc("media_library_flag_expired");
    setMsg(error ? `Could not flag: ${error.message}` : `${data} item(s) moved to review due.`);
    router.refresh();
  }

  async function save(r: MediaRow, form: FormData) {
    setMsg(null);
    const text = (k: string) => { const v = String(form.get(k) ?? "").trim(); return v === "" ? null : v; };
    const num = (k: string) => { const v = text(k); return v === null ? null : Number(v); };
    const status = String(form.get("content_status"));
    const patch = {
      title: String(form.get("title") ?? "").trim(), summary: text("summary"), voice: text("voice"), audio_url: text("audio_url"),
      duration_seconds: num("duration_seconds"), bytes: num("bytes"), reviewed_by_name: text("reviewed_by_name"), reviewed_at: text("reviewed_at"),
      next_review_due: text("next_review_due"),
      ...(r.series === "faith_reflection" ? { faith_leader_reviewer_name: text("faith_leader_reviewer_name"), faith_leader_reviewer_role: text("faith_leader_reviewer_role"), faith_leader_reviewed_at: text("faith_leader_reviewed_at") } : {}),
      is_placeholder: form.get("is_placeholder") === "on", content_status: status, is_active: status === "published",
    };
    const { error } = await createClient().from("media_library").update(patch).eq("id", r.id);
    if (error) setMsg(error.message);
    else { setMsg("Saved."); setOpen(null); router.refresh(); }
  }

  return (
    <div className="space-y-4">
      {report && (
        <p className="text-sm">
          {report.servable} in date and live, {report.placeholders} draft placeholders, {report.draft} drafts, {report.expired} past their review date.
          <Button type="button" size="sm" variant="outline" className="ml-3" onClick={flag}>Mark expired items as review due</Button>
        </p>
      )}
      {msg && <p role="status" className="text-sm">{msg}</p>}
      {rows.map((r) => (
        <Card key={r.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">{r.title} <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60">({r.code}, {r.kind}, {r.series})</span></CardTitle>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Close" : "Edit"}</Button>
          </CardHeader>
          <CardContent className="text-xs">
            {r.content_status}{r.is_placeholder ? ", placeholder" : ""}{r.next_review_due ? `, next review ${r.next_review_due}` : ""}
            {r.script?.needs_clinical_review && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">Draft script, needs review</span>}
            {open === r.id && r.script?.narration && (
              <div className="mt-3 space-y-1 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-3">
                <p className="font-medium">Draft narration for review{r.script.estimated_minutes ? ` (about ${r.script.estimated_minutes} minutes spoken)` : ""}</p>
                {r.script.voice_note && <p className="text-charcoal-ink/60 dark:text-night-ink/60">Voice note: {r.script.voice_note}</p>}
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-sm">{r.script.narration}</pre>
                {r.script.sources && r.script.sources.length > 0 && <p className="text-charcoal-ink/60 dark:text-night-ink/60">Sources: {r.script.sources.join(", ")} (see docs/content/SOURCES.md)</p>}
              </div>
            )}
            {open === r.id && (
              <form action={(fd) => save(r, fd)} className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1">Title<input name="title" defaultValue={r.title} className={field} required /></label>
                <label className="grid gap-1">Voice<input name="voice" defaultValue={r.voice ?? ""} className={field} /></label>
                <label className="grid gap-1 sm:col-span-2">Summary<input name="summary" defaultValue={r.summary ?? ""} className={field} maxLength={400} /></label>
                <label className="grid gap-1 sm:col-span-2">Audio file address<input name="audio_url" defaultValue={r.audio_url ?? ""} className={field} /></label>
                <label className="grid gap-1">Length in seconds<input name="duration_seconds" type="number" defaultValue={r.duration_seconds ?? ""} className={field} /></label>
                <label className="grid gap-1">File size in bytes<input name="bytes" type="number" defaultValue={r.bytes ?? ""} className={field} /></label>
                <label className="grid gap-1">Reviewed by (name)<input name="reviewed_by_name" defaultValue={r.reviewed_by_name ?? ""} className={field} /></label>
                <label className="grid gap-1">Review date<input name="reviewed_at" type="date" defaultValue={r.reviewed_at ?? ""} className={field} /></label>
                <label className="grid gap-1">Next review due<input name="next_review_due" type="date" defaultValue={r.next_review_due ?? ""} className={field} /></label>
                {r.series === "faith_reflection" && (
                  <fieldset className="sm:col-span-2 grid gap-2 rounded-md border border-charcoal-ink/15 dark:border-night-ink/20 p-3 sm:grid-cols-3">
                    <legend className="px-1">Faith leader review (required to publish, in addition to the clinical reviewer)</legend>
                    <label className="grid gap-1">Name<input name="faith_leader_reviewer_name" defaultValue={r.faith_leader_reviewer_name ?? ""} className={field} /></label>
                    <label className="grid gap-1">Role<input name="faith_leader_reviewer_role" defaultValue={r.faith_leader_reviewer_role ?? ""} className={field} /></label>
                    <label className="grid gap-1">Review date<input name="faith_leader_reviewed_at" type="date" defaultValue={r.faith_leader_reviewed_at ?? ""} className={field} /></label>
                  </fieldset>
                )}
                <label className="grid gap-1">Status
                  <select name="content_status" defaultValue={r.content_status} className={field}>
                    <option value="draft">Draft</option><option value="published">Published</option><option value="review_due">Review due</option><option value="withdrawn">Withdrawn</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="is_placeholder" defaultChecked={r.is_placeholder} /> Still a draft placeholder (cannot be published while ticked)</label>
                <p className="sm:col-span-2 text-charcoal-ink/60 dark:text-night-ink/60">Script steps and breathing patterns for exercises are written by the content author in the database; this form does not edit them.</p>
                <Button type="submit" className="sm:col-span-2">Save</Button>
              </form>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
