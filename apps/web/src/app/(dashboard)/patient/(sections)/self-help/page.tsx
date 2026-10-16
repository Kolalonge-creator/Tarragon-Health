import { t } from "@tarragon/i18n";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { SEMANTIC_ICON } from "@/lib/icons";
import { SharedPhoneGate } from "@/components/mental-health/shared-phone-gate";
import { SharedPhoneSettings } from "@/components/mental-health/shared-phone-settings";
import { TherapyProgrammeList } from "@/components/therapy/programme-list";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Self-help programmes (S63, Module 14). Per-patient and private: the list and everything under it sit inside the shared-phone gate,
 * nothing here appears in a notification, and a person acting for someone else sees nothing (the programme functions act for the signed-in
 * person only). Programmes are drafts behind go-live guards that are off, so a real patient sees the calm "not open yet" state.
 */
export default async function PatientProgrammesPage() {
  const { profile, subjectId } = await getPatientDashboardContext();
  const actingForSomeoneElse = subjectId !== profile.id;

  return (
    <DashboardSection id="programmes" title={t("therapy.title")} description={t("therapy.intro")} icon={SEMANTIC_ICON.mood}>
      <SharedPhoneSettings />
      <SharedPhoneGate>
        {actingForSomeoneElse ? (
          <Card><CardContent className="py-4 text-sm">{t("therapy.guidance.not_available")}</CardContent></Card>
        ) : (
          <TherapyProgrammeList />
        )}
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("therapy.shared_phone.note")}</p>
      </SharedPhoneGate>
    </DashboardSection>
  );
}
