import { createClient } from "@/lib/supabase/server";
import { ROUTINE_CHART_READ_REASON } from "@/lib/clinical/audited-chart";
import { formatPatientDateTime } from "@/lib/format-date";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkNotesReviewedButton } from "./mark-notes-reviewed-button";

/**
 * Side-effect notes the patient (or someone acting for them) wrote about a medicine, for the next consultation (spec 8.7).
 * Read through the tie-gated, audited function (INV-10); a refusal or an error reads as "not available", never as "no notes".
 * Nothing here changes a medicine: the care team decides what, if anything, to do with a note.
 */
export async function SideEffectNotesPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("care_team_side_effect_notes", {
    p_patient: patientId,
    p_reason: ROUTINE_CHART_READ_REASON,
  });
  const notes = data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Side effects the patient wants to discuss</CardTitle>
        <CardDescription>Written by the patient in their own words, most recent first. Not a clinical report.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-charcoal-ink/60">Not available to you right now.</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.note_id} className="rounded-md border border-charcoal-ink/10 p-2 text-sm">
                <p className="font-medium">{n.drug_name}</p>
                <p>{n.note}</p>
                <p className="text-xs text-charcoal-ink/60">
                  {formatPatientDateTime(n.noted_at)}
                  {n.reviewed_at ? " · reviewed" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {!error && notes.some((n) => !n.reviewed_at) ? (
          <MarkNotesReviewedButton patientId={patientId} noteIds={notes.filter((n) => !n.reviewed_at).map((n) => n.note_id)} />
        ) : null}
      </CardContent>
    </Card>
  );
}
