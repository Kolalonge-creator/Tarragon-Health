import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { JoinCard } from "./join-card";

export const metadata = { title: "Join a Care Circle", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/**
 * The invite link a patient shares. The token is in the path so it survives the sign-in redirect; the page asks the database
 * whether THIS signed-in account may accept it, and every failure shows the same message (no hint who was invited).
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title="Join a Care Circle" icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/supporting", label: "People you support" }} />
      <JoinCard token={decodeURIComponent(token)} locale={uiLanguage} />
    </div>
  );
}
