import { createClient } from "@/lib/supabase/server";
import { readMedicationDoseLogAudited } from "@/lib/clinical/dose-log";
import { readWeeklyAdherence } from "@/lib/clinical/weekly-adherence";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_BADGE: Record<string, { variant: "green" | "red" | "amber"; label: string }> = {
  taken: { variant: "green", label: "Taken" },
  missed: { variant: "red", label: "Missed" },
  skipped: { variant: "amber", label: "Skipped" },
};

/**
 * medication_logs is append-only (20260830224528): every dose-taken/missed/
 * skipped action stands on its own, including corrections — so this is the
 * raw table (read through the audited function), not medication_logs_latest_per_slot, and deliberately shows
 * every entry rather than collapsing to one-per-slot. That full history,
 * not a same-day snapshot, is the actual point of the append-only change
 * (spec §1.4) — it feeds clinical review the same way the readings do.
 */
export async function MedicationAdherenceHistory({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  // INV-10: the table is closed to staff. A refusal or error shows as "not available", never as "No doses logged yet".
  const [result, week] = await Promise.all([
    readMedicationDoseLogAudited(supabase, patientId),
    readWeeklyAdherence(supabase, patientId),
  ]);
  const logs = result.status === "ok" ? result.rows : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dose log history</CardTitle>
        <CardDescription>
          Every dose entry this patient (or someone acting for them) has logged, most recent first,
          including corrections, which appear as their own new entry rather than replacing the
          original.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-md bg-charcoal-ink/5 p-3 text-sm text-charcoal-ink">
          {week.status !== "ok" ? (
            <p className="text-charcoal-ink/60">
              {week.status === "denied"
                ? "Weekly adherence is not available to you for this patient."
                : "Weekly adherence could not be loaded just now."}
            </p>
          ) : week.adherence.percent === null ? (
            <p className="text-charcoal-ink/60">
              Fewer than the minimum number of doses were due in the last 7 days, so no percentage is shown.
            </p>
          ) : (
            <>
              <p className="font-medium">
                Doses marked taken, last 7 days: {week.adherence.percent}% ({week.adherence.taken + week.adherence.late} of {week.adherence.due} due)
                {week.adherence.belowThreshold ? ` · below the ${week.adherence.thresholdPercent}% review line` : ""}
              </p>
              <p className="text-xs text-charcoal-ink/60">
                Skipped {week.adherence.skipped + week.adherence.unavailable}, no record {week.adherence.missed}. Self-reported by the patient
                and not a proportion of days covered; it is a prompt to ask, not a grade.
              </p>
            </>
          )}
        </div>
        {result.status !== "ok" ? (
          <p className="text-sm text-charcoal-ink/60">
            {result.status === "denied"
              ? "Dose history is not available to you for this patient."
              : "Dose history could not be loaded just now. Please try again."}
          </p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No doses logged yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {logs.map((log) => {
              const badge = STATUS_BADGE[log.status] ?? { variant: "amber" as const, label: log.status };
              return (
                <li key={log.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-charcoal-ink">
                      {log.medication?.drug_name ?? "Unknown medicine"}
                      {log.scheduled_time ? ` · ${log.scheduled_time}` : ""}
                    </p>
                    <p className="text-xs text-charcoal-ink/50">
                      {new Date(log.logged_at).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {log.logged_by_profile_id ? " · logged by a supporter" : ""}
                      {log.reason ? ` · ${log.reason}` : ""}
                    </p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
