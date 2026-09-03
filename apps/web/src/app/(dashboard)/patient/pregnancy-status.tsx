import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PregnancyForm } from "./pregnancy-form";
import { pregnancyLedCareBanner, type CarePlanCondition } from "@/lib/rules/womens-health-intersections";

/**
 * Pregnancy status + the obstetric-led guard (§20.2, generalised 2026-08-29
 * per §44.14: cross-programme chronic-disease intersections). If the patient
 * is pregnant AND on an active diabetes or hypertension care plan, we show a
 * prominent "your X care in pregnancy is led by antenatal care" banner — the
 * platform detects, refers, coordinates and supports, but does not
 * independently manage these conditions in pregnancy. Shown to women of
 * child-bearing context; harmless otherwise.
 */
export async function PregnancyStatus({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [{ data: preg }, { data: activePlans }] = await Promise.all([
    supabase
      .from("patient_pregnancy")
      .select("is_pregnant, estimated_due_date")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("care_plans")
      .select("condition")
      .eq("patient_id", patientId)
      .eq("status", "active"),
  ]);

  const isPregnant = preg?.is_pregnant ?? false;
  const activeConditions = (activePlans ?? []).map((p) => p.condition as CarePlanCondition);
  const banner = isPregnant ? pregnancyLedCareBanner(activeConditions) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pregnancy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {banner && (
          <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm text-charcoal-ink/90">
            <p className="font-medium text-amber-800">Your care in pregnancy is led by antenatal care</p>
            <p className="mt-1">{banner}</p>
          </div>
        )}
        <PregnancyForm
          initialIsPregnant={isPregnant}
          initialEdd={preg?.estimated_due_date ?? null}
        />
      </CardContent>
    </Card>
  );
}
