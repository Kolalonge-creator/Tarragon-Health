import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Patient-facing display of an individualised SpO2/temperature/pulse
 * target, when a clinician has set one (§6.10). Same null-gated, no-verdict
 * pattern as GlucoseInsights ("Your care team's target: X") — states the
 * number, never a judgement about the patient's condition. Renders nothing
 * when none of the three targets are set, which is the common case.
 */
export async function MyTargetsCard({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const [{ data: spo2 }, { data: temperature }, { data: pulse }] = await Promise.all([
    supabase.from("patient_spo2_targets").select("amber_threshold_pct").eq("patient_id", patientId).maybeSingle(),
    supabase
      .from("patient_temperature_targets")
      .select("amber_threshold_c")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("patient_pulse_targets")
      .select("resting_min_bpm, resting_max_bpm")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  if (!spo2 && !temperature && !pulse) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your individual targets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink/80">
        {spo2 && (
          <p>
            Your care team reviews an oxygen reading sooner if it falls to{" "}
            <span className="font-medium">{spo2.amber_threshold_pct}%</span> or below.
          </p>
        )}
        {temperature && (
          <p>
            Your care team reviews a temperature reading sooner if it reaches{" "}
            <span className="font-medium">{temperature.amber_threshold_c}°C</span> or above.
          </p>
        )}
        {pulse && (
          <p>
            Your usual resting pulse range is{" "}
            <span className="font-medium">
              {pulse.resting_min_bpm}-{pulse.resting_max_bpm} bpm
            </span>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
