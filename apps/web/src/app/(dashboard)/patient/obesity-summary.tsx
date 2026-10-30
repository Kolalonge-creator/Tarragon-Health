import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  obesityLabelTitleCase,
} from "@/lib/copy/condition-language";

import { formatPatientDate } from "@/lib/format-date";
/**
 * Patient-facing obesity summary, person-first and health-focused (§1.6/§23).
 * It surfaces the doctor-recorded assessment, never a software verdict: it is
 * null-gated on an existing obesity_assessments row and speaks of the care
 * team's assessment, focusing on health and next steps rather than a number or
 * appearance. Renders nothing if the patient has no assessment.
 */
const STATUS_COPY: Record<string, string> = {
  preclinical:
    "Your care team considers this a risk that is best addressed early. The focus is steady lifestyle support to help you stay well.",
  clinical:
    "Your care team is treating this as an ongoing condition. Your lifestyle programme is the main part of your care plan.",
};

export async function ObesitySummary({
  patientId,
  conditionLanguagePreference,
}: {
  patientId: string;
  conditionLanguagePreference?: string | null;
}) {
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
        <CardTitle>Your {obesityLabelTitleCase(conditionLanguagePreference).toLowerCase()} &amp; health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Your care team recorded this on {formatPatientDate(data.assessed_at)}. Weight is
          only one part of the picture, alongside your energy, sleep, blood pressure and how you feel,
          not a number on the scale.
        </p>
        {data.clinical_status && (
          <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{STATUS_COPY[data.clinical_status]}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {data.bmi != null && <Badge variant="blue">BMI {Number(data.bmi).toFixed(1)}</Badge>}
          {data.waist_risk && data.waist_risk !== "normal" && (
            <Badge variant="grey">Waist: raised, worth tracking with your care team</Badge>
          )}
        </div>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          You are welcome to ask your care team any questions about this. They will support you at a pace that suits you.
        </p>
      </CardContent>
    </Card>
  );
}
