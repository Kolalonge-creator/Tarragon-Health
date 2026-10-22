"use client";

import { useState } from "react";
import {
  hasAnyChoice, NOTHING_CHOSEN, parseWellbeingSummary, shareSummaryConfig, summarySections, type SummaryChoices, type WellbeingSummary,
} from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);

/**
 * "Share with my doctor" (S56b, function 1). The patient builds a short summary for their care team and nothing is chosen for them: every
 * section starts unticked. They see a PREVIEW of exactly what would be sent before anything leaves; sending is a separate, explicit tap. The
 * only things offered are scores, check-in averages and the sleep diary (the database builder cannot reach anything else). The same words can be shown full-screen to read out at a visit.
 * Behind the CMO-switched guard wellbeing_summary_share_enabled: the page does not render this card until it is open.
 */
export function ShareSummaryCard({ enabled }: { enabled: boolean }) {
  const cfg = shareSummaryConfig();
  const [choices, setChoices] = useState<SummaryChoices>(NOTHING_CHOSEN);
  const [preview, setPreview] = useState<{ summary: WellbeingSummary; note: string } | null>(null);
  const [state, setState] = useState<"idle" | "previewing" | "sending" | "sent" | "error" | "preview_error">("idle");
  const [aloud, setAloud] = useState(false);
  if (!enabled) return null;

  function change(next: Partial<SummaryChoices>) {
    setChoices((c) => ({ ...c, ...next }));
    setPreview(null); // a changed choice means the old preview no longer shows what would be sent
    setState("idle");
  }

  async function buildPreview() {
    setState("previewing");
    try {
      const { data, error } = await createClient().rpc("preview_wellbeing_summary", {
        p_include_screens: choices.screens, p_include_checkins: choices.checkins, p_include_sleep: choices.sleep,
      });
      if (error) throw error;
      setPreview({ summary: parseWellbeingSummary(data), note: choices.note.trim() });
      setState("idle");
    } catch {
      setPreview(null);
      setState("preview_error");
    }
  }

  async function send() {
    setState("sending");
    try {
      const { error } = await createClient().rpc("share_wellbeing_summary_with_care_team", {
        p_include_screens: choices.screens, p_include_checkins: choices.checkins, p_include_sleep: choices.sleep,
        ...(choices.note.trim() === "" ? {} : { p_note: choices.note.trim() }),
      });
      if (error) throw error;
      setState("sent");
    } catch {
      setState("error");
    }
  }

  const sections = preview ? summarySections(preview.summary, preview.note, tr) : [];
  const box = "flex min-h-11 cursor-pointer items-center gap-3 text-sm";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("wsum.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{tr("wsum.intro")}</p>
        {state === "sent" ? (
          <p role="status" className="text-sm font-medium">{tr("wsum.sent")}</p>
        ) : (
          <>
            <fieldset className="space-y-1">
              <legend className="sr-only">{tr("wsum.title")}</legend>
              <label className={box}><input type="checkbox" className="h-5 w-5" checked={choices.screens} onChange={(e) => change({ screens: e.target.checked })} />{tr("wsum.opt_screens")}</label>
              <label className={box}><input type="checkbox" className="h-5 w-5" checked={choices.checkins} onChange={(e) => change({ checkins: e.target.checked })} />{tr("wsum.opt_checkins")}</label>
              <label className={box}><input type="checkbox" className="h-5 w-5" checked={choices.sleep} onChange={(e) => change({ sleep: e.target.checked })} />{tr("wsum.opt_sleep")}</label>
            </fieldset>
            <div className="space-y-1">
              <label htmlFor="wsum-note" className="text-sm font-medium">{tr("wsum.note_label")}</label>
              <textarea
                id="wsum-note"
                rows={3}
                maxLength={cfg.note_max_chars}
                value={choices.note}
                onChange={(e) => change({ note: e.target.value })}
                className="w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 py-2 text-sm dark:border-night-ink/25"
              />
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{tr("wsum.note_hint", { max: cfg.note_max_chars })}</p>
            </div>

            {!hasAnyChoice(choices) && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{tr("wsum.nothing")}</p>}
            <Button type="button" variant="outline" onClick={buildPreview} disabled={!hasAnyChoice(choices) || state === "previewing"}>{tr("wsum.preview")}</Button>
            {state === "preview_error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{tr("wsum.preview_error")}</p>}

            {preview && (
              <div className="space-y-3 rounded-lg border border-charcoal-ink/15 p-3 dark:border-night-ink/20">
                <p className="text-sm font-medium">{tr("wsum.preview_title")}</p>
                {sections.map((s) => (
                  <div key={s.heading} className="space-y-1">
                    <p className="text-sm font-medium">{s.heading}</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  </div>
                ))}
                <div className="flex flex-wrap gap-3">
                  <Button type="button" onClick={send} disabled={state === "sending"}>{state === "sending" ? tr("wsum.sending") : tr("wsum.send")}</Button>
                  <Button type="button" variant="outline" onClick={() => setAloud(true)}>{tr("wsum.read_aloud")}</Button>
                </div>
                {state === "error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{tr("wsum.error")}</p>}
              </div>
            )}
          </>
        )}
      </CardContent>
      {aloud && (
        <div role="dialog" aria-modal="true" aria-label={tr("wsum.title")} className="fixed inset-0 z-50 overflow-y-auto bg-white p-6 text-charcoal-ink dark:bg-night-ground dark:text-night-ink">
          <div className="mx-auto max-w-xl space-y-6">
            <button type="button" onClick={() => setAloud(false)} className="min-h-12 rounded-lg border-2 border-charcoal-ink/30 px-4 text-base font-semibold dark:border-night-ink/40">{tr("wsum.close_screen")}</button>
            {sections.map((s) => (
              <div key={s.heading} className="space-y-2">
                <h2 className="text-xl font-semibold">{s.heading}</h2>
                <ul className="list-disc space-y-1 pl-6 text-lg">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
