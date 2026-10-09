import { redirect } from "next/navigation";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { groupListSchema } from "@/lib/community/model";
import { t } from "@tarragon/i18n";
import Link from "next/link";
import { GroupSearch } from "./group-search";
import { MUTED } from "./styles";

export const metadata = { title: "Community", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CommunityPage() {
  const { acting, profile, uiLanguage } = await getPatientDashboardContext();
  // Community belongs to the person's own account. Someone acting for another person, or a supporter-only account, never joins on their behalf.
  if (acting || profile.receives_care === false) redirect("/patient");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_list_groups");
  const parsed = error ? null : groupListSchema.safeParse(data);
  const list = parsed?.success ? parsed.data : null;

  // Closed (the go-live guard is off), unreadable, or not an adult: say one calm thing and nothing else.
  let body: React.ReactNode;
  if (!list || !list.open) body = <p className={MUTED}>{t("community.not_open", uiLanguage)}</p>;
  else if (!list.adult) body = <p className={MUTED}>{t("community.adults_only", uiLanguage)}</p>;
  else
    body = (
      <div className="space-y-6">
        <GroupSearch groups={list.groups} locale={uiLanguage} />
        <p>
          <Link href="/patient/community/appeals" className="text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
            {t("community.appeals.link", uiLanguage)}
          </Link>
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("community.page.title", uiLanguage)}
        icon={SEMANTIC_ICON.family}
        backTo={{ href: "/patient", label: "Dashboard" }}
        description={list?.open && list.adult ? t("community.page.subtitle", uiLanguage) : undefined}
      />
      {body}
    </div>
  );
}
