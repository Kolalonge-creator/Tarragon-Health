import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { myActionsSchema } from "@/lib/community/model";
import { t } from "@tarragon/i18n";
import { MUTED } from "../styles";
import { AppealsList } from "./appeals-list";

export const metadata = { title: "Community", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CommunityAppealsPage() {
  const { acting, profile, uiLanguage } = await getPatientDashboardContext();
  if (acting || profile.receives_care === false) redirect("/patient");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_my_actions");
  const parsed = error ? null : myActionsSchema.safeParse(data);
  const actions = parsed?.success ? parsed.data : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("community.appeals.title", uiLanguage)}
        icon={SEMANTIC_ICON.family}
        backTo={{ href: "/patient/community", label: t("community.page.title", uiLanguage) }}
        description={actions?.open ? t("community.appeals.intro", uiLanguage) : undefined}
      />
      {actions && actions.open ? <AppealsList actions={actions} locale={uiLanguage} /> : <p className={MUTED}>{t("community.not_open", uiLanguage)}</p>}
    </div>
  );
}
