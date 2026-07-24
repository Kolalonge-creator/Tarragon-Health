import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Patient-facing obesity summary — person-first and health-focused (§1.6/§23).
 * It surfaces the doctor-recorded assessment, never a software verdict: it is
 * null-gated on an existing obesity_assessments row and speaks of the care
 * team's assessment, focusing on health and next steps rather than a number or
 * appearance. Renders nothing if the patient has no assessment.
 */
const STATUS_COPY: Record<string, string> = {
  preclinical:
    "Your care team sees this as a risk state to get ahead of — the focus is steady lifestyle support to keep you well.",
  clinical:
    "Your care team is managing this as an ongoing condition, with your lifestyle programme at the centre of your plan.",
};

export async function ObesitySummary({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("obesity_assessments")
    .select("bmi, bmi_category, waist_risk, clinical_status, assessed_at")
    .eq("patient_id", patientId)
    .order("assessed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your weight &amp; health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          Your care team recorded this on {new Date(data.assessed_at).toLocaleDateString()}. Weight is
          only one part of the picture — the goal is your energy, sleep, blood pressure and how you feel,
          not a number on the scale.
        </p>
        {data.clinical_status && (
          <p className="text-sm text-charcoal-ink/80">{STATUS_COPY[data.clinical_status]}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {data.bmi != null && <Badge variant="blue">BMI {Number(data.bmi).toFixed(1)}</Badge>}
          {data.waist_risk && data.waist_risk !== "normal" && (
            <Badge variant="grey">Waist: raised — a key thing to improve, and it responds well</Badge>
          )}
        </div>
        <p className="text-xs text-charcoal-ink/60">
          Any questions about this are welcome — your care team is here to support you, one small step at a
          time.
        </p>
      </CardContent>
    </Card>
  );
}
