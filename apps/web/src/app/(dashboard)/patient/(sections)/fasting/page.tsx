import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { FastingClient } from "../../fasting-client";

/**
 * Fasting and your health (S50b, 6.13). Lives inside the patient sections layout on purpose, so the emergency alert and the one-touch danger check
 * that sit above every section stay above this page: the emergency guidance is the existing path, not a copy of it.
 * It is for the person's own account only; someone acting for another person sees nothing here.
 */
export default async function PatientFastingPage() {
  const { acting } = await getPatientDashboardContext();
  if (acting) {
    return (
      <DashboardSection id="fasting" title={t("fasting.title")} description={t("fasting.answer.unavailable")} icon={SEMANTIC_ICON.nutrition}>
        <p className="text-sm">{t("fasting.answer.unavailable")}</p>
      </DashboardSection>
    );
  }
  return (
    <DashboardSection id="fasting" title={t("fasting.title")} description={t("fasting.disclaimer")} icon={SEMANTIC_ICON.nutrition}>
      <FastingClient />
    </DashboardSection>
  );
}
