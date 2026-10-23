"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseWellbeingSummary, summarySections } from "@tarragon/shared";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { useMentalHealthHandoffs, mentalHealthKey } from "@/lib/queries/mental-health";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const tr = (key: string, params?: Record<string, string | number>) => t(key as MessageKey, "en", params);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

/**
 * What a patient chose to send their care team (S56b): a shared summary, a request to talk, or a questionnaire hand-off. Read through the
 * audited function (INV-10, INV-12), so a clinician without a tie to the patient sees nothing here and the refusal is logged. "Mark as seen"
 * is the clinician's explicit act; it clears the hand-off from the follow-up worklist.
 */
export function SharedSummaries({ patientId }: { patientId: string }) {
  const { data, isError } = useMentalHealthHandoffs(patientId);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (isError || !data) return null;
  const rows = data;
  if (rows.length === 0) return null;

  async function markSeen(id: string) {
    setBusy(id);
    setFailed(false);
    try {
      const { data: ok, error } = await createClient().rpc("mark_mental_health_handoff_seen", { p_handoff: id });
      if (error || ok === null) throw error ?? new Error("not allowed");
      await queryClient.invalidateQueries({ queryKey: mentalHealthKey(patientId) });
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card variant="soft">
      <CardHeader>
        <CardTitle className="text-base">Sent to the care team by the patient</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {rows.map((h) => (
          <div key={h.id} className="space-y-2 border-b border-charcoal-ink/10 pb-3 last:border-0 dark:border-night-ink/15">
            <p className="font-medium">
              {h.kind === "doctor_summary" ? "Summary the patient chose to share" : h.kind === "talk_request" ? "The patient asked someone to get in touch" : "Questionnaire the patient sent"}, {when(h.created_at)}
              {h.state === "open" ? "" : h.seen_at ? `. Marked seen ${when(h.seen_at)}.` : `. ${h.state}.`}
            </p>
            {h.kind === "doctor_summary" &&
              summarySections(parseWellbeingSummary(h.summary), h.patient_note, tr).map((s) => (
                <div key={s.heading}>
                  <p className="font-medium">{s.heading}</p>
                  <ul className="list-disc pl-5 text-charcoal-ink/85 dark:text-night-ink/85">{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                </div>
              ))}
            {h.kind === "screen" && typeof h.summary.instrument === "string" && (
              <p className="text-charcoal-ink/85 dark:text-night-ink/85">{String(h.summary.instrument).toUpperCase()} {String(h.summary.severity_band ?? "")} {String(h.summary.total_score ?? "")}</p>
            )}
            {h.kind !== "doctor_summary" && h.patient_note && <p className="text-charcoal-ink/85 dark:text-night-ink/85">{h.patient_note}</p>}
            {h.state === "open" && (
              <Button type="button" size="sm" variant="outline" disabled={busy === h.id} onClick={() => markSeen(h.id)}>
                Mark as seen
              </Button>
            )}
          </div>
        ))}
        {failed && <p role="alert" className="text-red-600 dark:text-red-400">That could not be saved. Please try again.</p>}
      </CardContent>
    </Card>
  );
}
