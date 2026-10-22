"use client";

import { birthPlanFlags, gestationalAge } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { useMaternalFollowUpOpen } from "@/lib/queries/growth";
import { useActivePregnancy, useBirthPlan } from "@/lib/queries/pregnancy-tools";
import { todayIsoDate } from "@/lib/queries/medications";
import { AntenatalSchedule } from "./antenatal-schedule";
import { BirthPlanForm } from "./birth-plan-form";
import { ContractionTimer } from "./contraction-timer";
import { KickCounter } from "./kick-counter";
import { WeekCard } from "./week-card";

/**
 * The patient pregnancy tools (S67 follow-up, OQ-346): week card, antenatal schedule, baby movement counter, contraction timer and birth
 * plan. Rendered inside the Women's Health PrivateSection (S66 lock) and ONLY once the `maternal_enabled` go-live guard is open for this
 * person (INV-14; test accounts pass, real patients see nothing while it is off). A guard that cannot be read counts as closed.
 */
export function PregnancyTools({
  patientId,
  organisationId,
  lmp,
  edd,
  today = todayIsoDate(),
}: {
  patientId: string;
  organisationId: string | null;
  lmp: string | null;
  edd: string | null;
  today?: string;
}) {
  const open = useMaternalFollowUpOpen();
  const pregnancy = useActivePregnancy(patientId);
  const pregnancyId = pregnancy.data?.id ?? null;
  const plan = useBirthPlan(pregnancyId);
  if (open.data !== true || !organisationId) return null;

  const week = gestationalAge({ lmp, edd, today })?.weeks ?? null;
  return (
    <section aria-labelledby="preg-tools-title" className="space-y-4">
      <div>
        <h2 id="preg-tools-title" className="text-lg font-semibold">{t("preg.ui.section_title")}</h2>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("preg.ui.section_intro")}</p>
      </div>
      <WeekCard week={week} />
      <AntenatalSchedule patientId={patientId} />
      <KickCounter patientId={patientId} organisationId={organisationId} week={week} />
      <ContractionTimer patientId={patientId} organisationId={organisationId} week={week} flags={birthPlanFlags(plan.data)} planUnavailable={plan.isError} />
      <BirthPlanForm patientId={patientId} organisationId={organisationId} pregnancyId={pregnancyId} />
    </section>
  );
}
