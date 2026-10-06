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
/** A malformed escape is the same "this link does not work" as any other bad link, never a server error. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title="Join a Care Circle" icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/supporting", label: "People you support" }} />
      <JoinCard token={safeDecode(token)} locale={uiLanguage} />
    </div>
  );
}
