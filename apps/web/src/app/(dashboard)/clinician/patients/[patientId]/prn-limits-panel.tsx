import { createClient } from "@/lib/supabase/server";
import { readPatientMedicationsAudited } from "@/lib/clinical/medications-audited";
import { readPrnOverview } from "@/lib/clinical/prn-overview";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PrnLimitsForm } from "./prn-limits-form";

/**
 * As-needed medicines and the limits the care team has set for them (S08x, decision C7). Shown only when the patient
 * has an active as-needed medicine. A read that fails or is refused says so; it never reads as "no limits".
 * Limits are set per medicine, with a reason, inside the bounds the Chief Medical Officer signed. A dose over a limit
 * is still logged and the patient is told to check with the care team; this panel only shows how often that happened.
 */
export async function PrnLimitsPanel({ patientId, canSet }: { patientId: string; canSet: boolean }) {
  const supabase = await createClient();
  const [meds, overview] = await Promise.all([
    readPatientMedicationsAudited(supabase, patientId, { active: true }),
    readPrnOverview(supabase, patientId),
  ]);
  if (meds.status !== "ok") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>As-needed medicine limits</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">
            {meds.status === "denied"
              ? "This patient's medicines are not available to you, so their as-needed limits cannot be shown."
              : "The medicines could not be loaded just now, so as-needed limits cannot be shown. Do not assume none are set."}
          </p>
        </CardContent>
      </Card>
    );
  }
  const asNeeded = meds.rows.filter(
    (m) => !m.superseded_at && (m.schedule_spec as { kind?: string } | null)?.kind === "as_needed",
  );
  if (asNeeded.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>As-needed medicine limits</CardTitle>
        <CardDescription>
          A shortest gap and/or a most doses per day, set by you for one medicine. There are no defaults. A dose over a limit is still
          recorded, and the patient is told to check with the care team before taking another.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {overview.status !== "ok" && (
          <p className="text-sm text-charcoal-ink/60">
            {overview.status === "denied"
              ? "Limits are not available to you for this patient."
              : "Limits could not be loaded just now. Do not assume none are set."}
          </p>
        )}
        {asNeeded.map((m) => {
          const limit = overview.status === "ok" ? overview.limits.find((l) => l.medicationId === m.id) : undefined;
          const flagged = overview.status === "ok" ? (overview.flagged.find((f) => f.medicationId === m.id)?.doses ?? 0) : 0;
          return (
            <div key={m.id} className="rounded-md border border-mist-grey/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-charcoal-ink">{m.drug_name}</p>
                {limit ? (
                  <Badge variant="blue">
                    {[limit.minGapMinutes !== null ? `gap ${limit.minGapMinutes} min` : null, limit.dailyMax !== null ? `max ${limit.dailyMax}/day` : null]
                      .filter(Boolean)
                      .join(", ")}
                  </Badge>
                ) : overview.status === "ok" ? (
                  <Badge variant="grey">No limits set</Badge>
                ) : null}
                {flagged > 0 && <Badge variant="amber">{flagged} dose{flagged === 1 ? "" : "s"} over the limit in 7 days</Badge>}
              </div>
              <PrnLimitsForm
                patientId={patientId}
                medicationId={m.id}
                minGapMinutes={limit?.minGapMinutes ?? null}
                dailyMax={limit?.dailyMax ?? null}
                canSet={canSet && overview.status === "ok"}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
