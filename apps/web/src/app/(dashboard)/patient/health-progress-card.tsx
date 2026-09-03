import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * "Your health progress" (Patient Engagement Engine spec §16.5) — deliberately
 * a per-area breakdown, not a single number. Same design principle
 * PreventionCompletionCard already established on this page ("avoid
 * presenting a misleading single health score ... a completion dashboard is
 * safer and more actionable") applies here too: composite_score and
 * engagement_level exist in care_engagement_scores for staff triage, but a
 * patient sees the breakdown that actually answers "what am I doing well /
 * where could I use a hand" — encouragement and visibility, never a verdict.
 */
const DIMENSION_LABEL = {
  monitoring_adherence_score: "Monitoring",
  appointment_attendance_score: "Appointments",
  medication_adherence_score: "Medication",
  lifestyle_score: "Lifestyle",
  prevention_score: "Prevention",
  care_plan_completion_score: "Care plan",
} as const;

type DimensionKey = keyof typeof DIMENSION_LABEL;

const DIMENSION_ORDER: DimensionKey[] = [
  "monitoring_adherence_score",
  "appointment_attendance_score",
  "medication_adherence_score",
  "lifestyle_score",
  "prevention_score",
  "care_plan_completion_score",
];

export async function HealthProgressCard({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("patient_current_care_engagement")
    .select(
      "monitoring_adherence_score, appointment_attendance_score, medication_adherence_score, lifestyle_score, prevention_score, care_plan_completion_score"
    )
    .eq("patient_id", patientId)
    .maybeSingle();

  if (!data) return null;

  const withNulls = DIMENSION_ORDER.map((key) => ({ key, label: DIMENSION_LABEL[key], value: data[key] }));
  const dimensions = withNulls.filter(
    (d): d is (typeof withNulls)[number] & { value: number } => d.value !== null
  );

  // Nothing applicable yet (e.g. a patient with no care plan, no appointments,
  // no monitoring history) — nothing honest to show, same self-hiding
  // convention as every other conditional card on this page.
  if (dimensions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.impact className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your health progress
        </CardTitle>
        <p className="text-sm text-charcoal-ink/60">
          A quick look at how things are going across the areas you&apos;re working on.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {dimensions.map((d) => {
          const rounded = Math.round(d.value);
          return (
            <div key={d.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-charcoal-ink">{d.label}</span>
                <span className="font-medium text-charcoal-ink">{rounded}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-charcoal-ink/10">
                {/* Clinical status colours (green/amber), never brand-green: this bar
                    communicates status, and the two colour systems must not mix. */}
                <div
                  className={`h-full rounded-full ${rounded >= 70 ? "bg-green-500" : "bg-amber-500"}`}
                  style={{ width: `${rounded}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
