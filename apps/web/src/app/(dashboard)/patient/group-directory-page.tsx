import { DashboardSection } from "@/components/ui/dashboard-section";
import { FeatureDirectory } from "@/components/patient/feature-directory";
import { APP_ICON } from "@/lib/icons";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { getPatientSignals } from "@/lib/patient/feature-signals";
import {
  featuresInGroup,
  GROUP_META,
  isFeatureRelevant,
  type FeatureGroup,
} from "@/lib/patient/feature-registry";

/**
 * The shared body of the four group directory pages (/patient/health,
 * /stay-well, /support, /account). One implementation, four thin routes, so
 * a group can never drift into presenting itself differently from its peers.
 *
 * Everything in the group is listed, in registry order. Nothing is filtered
 * out by relevance: relevance decides what we bring UP unprompted (the
 * discovery card on Overview), never what a patient is allowed to find when
 * they came looking. The one thing relevance does here is dim the rows their
 * plan does not cover, so the page reads honestly at a glance without hiding
 * anything.
 */
export async function GroupDirectoryPage({ group }: { group: FeatureGroup }) {
  const { subjectId } = await getPatientDashboardContext();
  const signals = await getPatientSignals(subjectId);
  const features = featuresInGroup(group);
  const meta = GROUP_META[group];

  // Only entitlement misses dim a row. A feature that is simply not for this
  // patient right now (a diabetes log for somebody without diabetes) reads
  // perfectly well as a plain row; badging it "not for you" would be both
  // presumptuous and, given how often our record is incomplete, often wrong.
  const dimmedIds = features
    .filter((f) => f.relevance?.feature && !isFeatureRelevant(f, signals))
    .map((f) => f.id);

  return (
    <DashboardSection
      id={group.toLowerCase().replace(/\s+/g, "-")}
      title={group}
      description={meta.description}
      icon={APP_ICON[meta.icon]}
    >
      <FeatureDirectory features={features} dimmedIds={dimmedIds} />
    </DashboardSection>
  );
}
