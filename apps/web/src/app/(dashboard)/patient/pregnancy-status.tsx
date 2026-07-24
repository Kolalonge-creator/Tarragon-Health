import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PregnancyForm } from "./pregnancy-form";

/**
 * Pregnancy status + the obstetric-led guard (§20.2). If the patient is
 * pregnant AND on a diabetes care plan, we show a prominent "your diabetes care
 * in pregnancy is led by antenatal care" banner — the platform detects,
 * refers, coordinates and supports, but does not independently manage diabetes
 * in pregnancy. Shown to women of child-bearing context; harmless otherwise.
 */
export async function PregnancyStatus({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [{ data: preg }, { data: dmPlan }] = await Promise.all([
    supabase
      .from("patient_pregnancy")
      .select("is_pregnant, estimated_due_date")
      .eq("patient_id", patientId)
      .maybeSingle(),
    supabase
      .from("care_plans")
      .select("id")
      .eq("patient_id", patientId)
      .eq("condition", "diabetes")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  const isPregnant = preg?.is_pregnant ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pregnancy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPregnant && dmPlan && (
          <div className="rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm text-charcoal-ink/90">
            <p className="font-medium text-amber-800">Your diabetes care in pregnancy is led by antenatal care</p>
            <p className="mt-1">
              Diabetes in pregnancy needs tighter control and specialist oversight, so your care is
              led by an obstetric / antenatal team. Please make sure you&apos;re booked into antenatal
              care — your Tarragon team will help coordinate and stay in touch, but won&apos;t manage
              your diabetes on its own during pregnancy. Some diabetes tablets are usually stopped in
              pregnancy, so don&apos;t change anything without your antenatal team.
            </p>
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
