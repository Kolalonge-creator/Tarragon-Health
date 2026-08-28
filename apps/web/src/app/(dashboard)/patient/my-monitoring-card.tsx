import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { VITAL_TYPE_LABEL } from "@/lib/vitals/target-fields";

/**
 * "My monitoring" (spec §6.15) — per-scheduled-vital completion over the
 * last 28 days, e.g. "Blood pressure: 8/12 readings · 67%". Deliberately a
 * plain completion bar, not a gamified score — the spec is explicit this
 * should "focus on actionable behaviour rather than gamification alone",
 * the same restraint PreventionCompletionCard (right above this on the
 * dashboard) already applies to preventive care.
 *
 * Renders nothing for a patient with no active monitoring_schedule_items
 * (not yet enrolled in a chronic programme) rather than an empty card.
 */
export async function MyMonitoringCard({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("patient_vitals_adherence", { p_patient_id: patientId });

  if (!data || data.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.bp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          My monitoring
        </CardTitle>
        <p className="text-sm text-charcoal-ink/60">Readings logged over the last 28 days.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((item) => {
          const pct = Math.max(0, Math.min(100, item.adherence_pct ?? 0));
          const label = VITAL_TYPE_LABEL[item.vital_type] ?? item.vital_type;
          return (
            <div key={item.schedule_item_id}>
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal-ink">{label}</span>
                <span className="text-charcoal-ink/60">
                  {item.completed_count}/{item.expected_count} · {pct}%
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-charcoal-ink/10">
                <div className="h-full rounded-full bg-brand-green" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
