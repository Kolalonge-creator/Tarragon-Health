import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { TopicDetailView } from "@/app/(dashboard)/patient/health-education";

/**
 * A single Learn topic on its own page. The content's own title becomes the
 * on-page heading (see TopicDetailView's CardTitle) — the code isn't known
 * to be a real, current topic until the client-side fetch resolves, so this
 * header stays generic rather than guessing.
 */
export default async function LearnTopicPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const { profile, subjectId } = await getPatientDashboardContext();

  if (!profile.organisation_id) {
    return null;
  }
  const organisationId = profile.organisation_id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Learn"
        icon={SEMANTIC_ICON.learn}
        backTo={{ href: "/patient/learn", label: "All topics" }}
      />
      <TopicDetailView
        code={code}
        patientId={subjectId}
        organisationId={organisationId}
        conditionLanguagePreference={profile.condition_language_preference}
      />
    </div>
  );
}
