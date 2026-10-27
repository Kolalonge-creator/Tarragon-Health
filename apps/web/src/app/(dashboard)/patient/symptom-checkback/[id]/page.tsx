import { notFound } from "next/navigation";
import { z } from "zod";
import { t } from "@tarragon/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { isSymptomCheckerOpen } from "@/lib/symptom-triage/protocol";
import { loadAssessmentUx } from "@/lib/symptom-triage/ux-config";
import { readCheckbackView } from "@/lib/symptom-checkback/answer";
import { CheckbackForm } from "./checkback-form";

/**
 * S59c: the follow-up after a symptom check. `my_symptom_checkback()` answers only for the signed-in person's own follow-up; anyone else,
 * and an unknown id, gets the same 404, so this page cannot be used to probe for ids. Unreachable while the symptom checker guard is off
 * (a calm closed state, never an error). Answering is optional and nothing depends on it.
 */
export default async function SymptomCheckbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const header = <PageHeader title={t("symptom.checkback.title")} icon={SEMANTIC_ICON.clinicianFollowUp} backTo={{ href: "/patient/vitals#symptom-check", label: t("symptom.mobile.title") }} />;
  if (!(await isSymptomCheckerOpen(supabase))) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("symptom.checkback.closed")}</p>
      </div>
    );
  }
  const view = await readCheckbackView(supabase as never, id);
  if (!view) notFound();
  const ux = await loadAssessmentUx();
  return (
    <div className="space-y-6">
      {header}
      <CheckbackForm view={view} safetyNet={ux.safetyNet} />
    </div>
  );
}
