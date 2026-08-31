import { createClient } from "@/lib/supabase/server";
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
 * raw table, not medication_logs_latest_per_slot, and deliberately shows
 * every entry rather than collapsing to one-per-slot. That full history,
 * not a same-day snapshot, is the actual point of the append-only change
 * (spec §1.4) — it feeds clinical review the same way the readings do.
 */
export async function MedicationAdherenceHistory({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data: logs } = await supabase
    .from("medication_logs")
    .select(
      "id, status, reason, logged_at, scheduled_for_date, scheduled_time, logged_by_profile_id, medication:medications!medication_logs_medication_id_fkey(drug_name)"
    )
    .eq("patient_id", patientId)
    .order("logged_at", { ascending: false })
    .limit(100);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dose log history</CardTitle>
        <CardDescription>
          Every dose entry this patient (or someone acting for them) has logged, most recent first —
          including corrections, which appear as their own new entry rather than replacing the
          original.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!logs || logs.length === 0 ? (
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
