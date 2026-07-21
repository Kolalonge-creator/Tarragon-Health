import { createClient } from "@/lib/supabase/server";
import { computeTimeInRange, windowStartIso } from "@/lib/vitals/time-in-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const WINDOW_DAYS = 14;

/**
 * Patient-facing glucose insights: time-in-range over the last 14 days (§10.3)
 * and their individual target if a clinician has set one (§9). Null-gated —
 * renders nothing until there's data, and never states control (§22): it shows
 * the numbers, not a verdict.
 */
export async function GlucoseInsights({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const since = windowStartIso(WINDOW_DAYS);

  const [{ data: readings }, { data: target }] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("glucose_mmol_l")
      .eq("patient_id", patientId)
      .eq("vital_type", "glucose")
      .gte("taken_at", since),
    supabase
      .from("patient_glucose_targets")
      .select("category, hba1c_target_percent, upper_target")
      .eq("patient_id", patientId)
      .maybeSingle(),
  ]);

  const values = (readings ?? []).map((r) => r.glucose_mmol_l).filter((v): v is number => v !== null);
  const tir = computeTimeInRange(values, { high: target?.upper_target ?? undefined });

  if (!tir && !target) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your glucose insights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {target && (
          <p className="text-charcoal-ink/80">
            Your care team&apos;s target:{" "}
            {target.hba1c_target_percent ? (
              <span className="font-medium">HbA1c under {target.hba1c_target_percent}%</span>
            ) : (
              <span className="font-medium">{target.category}</span>
            )}
            .
          </p>
        )}
        {tir ? (
          <div className="space-y-1.5">
            <p className="text-charcoal-ink/80">
              Last {WINDOW_DAYS} days ({tir.total} readings) — how often you were in range
              ({tir.low}–{tir.high} mmol/L):
            </p>
            <div className="flex h-4 w-full overflow-hidden rounded-full bg-charcoal-ink/10">
              {tir.belowPct > 0 && <div className="bg-red-400" style={{ width: `${tir.belowPct}%` }} />}
              <div className="bg-brand-green" style={{ width: `${tir.inRangePct}%` }} />
              {tir.abovePct > 0 && <div className="bg-amber-400" style={{ width: `${tir.abovePct}%` }} />}
            </div>
            <p className="text-charcoal-ink/60">
              {tir.inRangePct}% in range · {tir.belowPct}% low · {tir.abovePct}% high. Your doctor
              reviews the pattern — a single reading isn&apos;t the whole picture.
            </p>
          </div>
        ) : (
          <p className="text-charcoal-ink/60">Log a few glucose readings to see your time-in-range.</p>
        )}
      </CardContent>
    </Card>
  );
}
