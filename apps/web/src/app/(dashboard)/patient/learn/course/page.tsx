import { asLocale, t } from "@tarragon/i18n";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { BpCourse } from "./bp-course";
import { BP_COURSE_CODE, parseLesson, type CourseRow } from "./course-model";

/**
 * The blood pressure care course (S33). The database serves only published lessons whose review date has not passed, in
 * English, so an empty list means the course is not
 * open yet, never an error to show as one.
 */
export default async function CoursePage() {
  const { profile, subjectId, uiLanguage } = await getPatientDashboardContext();
  if (!profile.organisation_id) return null;
  const locale = asLocale(uiLanguage);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("learning_course", { p_programme_code: BP_COURSE_CODE });
  const lessons = error ? [] : (data ?? []).map((r) => parseLesson(r as unknown as CourseRow));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("course.title", locale)}
        icon={SEMANTIC_ICON.learn}
        backTo={{ href: "/patient/learn", label: "Learn" }}
        description={t("course.subtitle", locale)}
      />
      {error ? (
        <p>{t("course.error.load", locale)}</p>
      ) : lessons.length === 0 ? (
        <p>{t("course.not_open", locale)}</p>
      ) : (
        <BpCourse lessons={lessons} locale={locale} patientId={subjectId} organisationId={profile.organisation_id} />
      )}
    </div>
  );
}
