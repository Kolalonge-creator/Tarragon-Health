import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { t } from "@tarragon/i18n";
import { RewardRulesManager } from "./reward-rules-manager";

export const metadata = { title: "Health Points rules" };

export default async function RewardRulesPage() {
  const profile = await getCurrentProfile();
  // proxy.ts already keeps non-admins out of /admin/**; this is defence in depth, same as the other settings pages.
  if (profile?.role !== "admin") redirect("/admin");

  return (
    <div className="space-y-6">
      <PageHeader title={t("points.admin.title")} description={t("points.admin.intro")} />
      <RewardRulesManager />
    </div>
  );
}
