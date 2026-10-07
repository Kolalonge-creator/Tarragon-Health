import { asLocale, t } from "@tarragon/i18n";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { BreathingExercise } from "./breathing-exercise";

/** BRE-01 "Three minute calm" (S33). Needs no data to run and asks for no reading. */
export default async function BreathingPage() {
  const { profile, uiLanguage } = await getPatientDashboardContext();
  if (!profile.organisation_id) return null;
  const locale = asLocale(uiLanguage);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("breathing.title", locale)}
        icon={SEMANTIC_ICON.learn}
        backTo={{ href: "/patient/learn", label: "Learn" }}
        description={t("breathing.intro", locale)}
      />
      <BreathingExercise locale={locale} />
    </div>
  );
}
