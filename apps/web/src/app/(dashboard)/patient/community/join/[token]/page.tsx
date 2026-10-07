import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { t } from "@tarragon/i18n";
import { CommunityJoinCard } from "./join-card";

export const metadata = { title: "Join a group", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/** A malformed escape is the same "this link does not work" as any other bad link, never a server error. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

/**
 * The invite link a moderator shares. The token is in the path so it survives the sign-in redirect (the login page now carries it through
 * "Create an account" too, OQ-220); the page asks the database whether THIS signed-in account may use it, and every failure shows the same
 * message.
 */
export default async function CommunityJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { uiLanguage } = await getPatientDashboardContext();
  return (
    <div className="space-y-6">
      <PageHeader title={t("community.join.title", uiLanguage)} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient/community", label: t("community.title", uiLanguage) }} />
      <CommunityJoinCard token={safeDecode(token)} locale={uiLanguage} />
    </div>
  );
}
