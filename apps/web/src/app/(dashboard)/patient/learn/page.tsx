import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BP_COURSE_CODE } from "./course/course-model";
import { asLocale, t } from "@tarragon/i18n";
import { HealthEducationLibrary } from "@/app/(dashboard)/patient/health-education";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The patient-facing health library: a top-level destination (not a tab
 * buried inside Prevention) covering chronic conditions, prevention,
 * everyday wellness, and using Tarragon well — a couple hundred articles
 * across 14 browsable categories, not just whatever the personalisation
 * algorithm decided was relevant to a patient's own diagnoses. See
 * health-education.tsx for the "Recommended for you" rail (personalised,
 * paced) sitting above the full, ungated browse-by-category library.
 */
export default async function LearnPage() {
  const { profile, subjectId, uiLanguage } = await getPatientDashboardContext();
  const locale = asLocale(uiLanguage);
  // The course card appears only when the server returns lessons: nothing published means nothing shown.
  const supabase = await createClient();
  const { data: courseRows } = await supabase.rpc("learning_course", {
    p_programme_code: BP_COURSE_CODE,
  });
  const courseOpen = (courseRows ?? []).length > 0;

  if (!profile.organisation_id) {
    return null;
  }
  const organisationId = profile.organisation_id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Learn"
        icon={SEMANTIC_ICON.learn}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description="Clear, plain-language reading on your conditions and on staying healthy generally, written to take you from not knowing to actually understanding. Browse by topic, or start with what's recommended for you."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {courseOpen && (
          <Card>
            <CardHeader>
              <CardTitle>{t("course.title", locale)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p>{t("course.subtitle", locale)}</p>
              <Link
                className="font-medium underline"
                href="/patient/learn/course"
              >
                {t("course.start", locale)}
              </Link>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>{t("breathing.title", locale)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p>{t("breathing.intro", locale)}</p>
            <Link
              className="font-medium underline"
              href="/patient/learn/breathing"
            >
              {t("breathing.start", locale)}
            </Link>
          </CardContent>
        </Card>
      </div>
      <HealthEducationLibrary
        patientId={subjectId}
        organisationId={organisationId}
        conditionLanguagePreference={profile.condition_language_preference}
      />
    </div>
  );
}
