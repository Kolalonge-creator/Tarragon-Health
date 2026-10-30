import Link from "next/link";
import { t } from "@tarragon/i18n";
import { childChoices, normaliseCrisisCard, pickerState } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { PrivateSection } from "@/components/private-section/private-section";
import { ChildLogPanel, type ChildForPanel } from "@/components/child-log/child-log-panel";
import { ChildSwitchLink } from "@/components/child-log/child-switch";

/**
 * The daily child log (S68b): one-tap feed, sleep and nappy, a per-child timeline, growth with plain-language bands, the vaccine checklist and a
 * one-page PDF. Reads are through the signed-in person's own RLS, so a second caregiver sees only what their grant on the CHILD allows and nothing
 * of the mother's. Anything about the mother is a separate section behind the private lock and is not part of this page's data.
 */
export default async function ChildLogPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const { profile } = await getPatientDashboardContext();
  const { child: requested } = await searchParams;
  const supabase = await createClient();

  const [{ data: grants, error }, { data: card }] = await Promise.all([
    supabase
      .from("profile_access")
      .select("permission_level, profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account, dependent_kind, organisation_id, date_of_birth, sex)")
      .eq("grantee_user_id", profile.id),
    supabase.rpc("get_crisis_card"),
  ]);

  const header = <PageHeader title={t("cdl.title")} icon={SEMANTIC_ICON.family} backTo={{ href: "/patient", label: "Dashboard" }} />;
  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <p role="alert">{t("cdl.log.failed")}</p>
      </div>
    );
  }

  const rows = (grants ?? []).flatMap((g) => (g.profile ? [{ level: g.permission_level, p: g.profile }] : []));
  const choices = childChoices(
    rows.map(({ level, p }) => ({ profileId: p.id, fullName: p.full_name, permissionLevel: level, isDependentAccount: p.is_dependent_account === true, dependentKind: p.dependent_kind, dateOfBirth: p.date_of_birth ?? null })),
  );
  const state = pickerState(choices, requested ?? null);

  if (state.kind === "none") {
    return (
      <div className="space-y-6">
        {header}
        <p>{t("cdl.no_children")}</p>
      </div>
    );
  }
  if (state.kind === "ask") {
    return (
      <div className="space-y-6">
        {header}
        <h2 className="text-xl font-bold">{t("cdl.whose.title")}</h2>
        <p className="text-sm">{t("cdl.whose.help")}</p>
        <ul className="space-y-3">
          {state.choices.map((c) => (
            <li key={c.profileId}>
              <ChildSwitchLink accountId={profile.id} href={`/patient/child?child=${c.profileId}`} className="block rounded-xl border-2 border-brand-green px-4 py-5 text-center text-xl font-extrabold">
                {c.firstName}
              </ChildSwitchLink>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const chosen = rows.find((r) => r.p.id === state.child.profileId)!.p;
  const organisationId = chosen.organisation_id ?? profile.organisation_id;
  if (!organisationId) {
    return (
      <div className="space-y-6">
        {header}
        <p role="alert">{t("cdl.log.failed")}</p>
      </div>
    );
  }
  const child: ChildForPanel = {
    id: chosen.id,
    firstName: state.child.firstName,
    organisationId,
    dateOfBirth: chosen.date_of_birth ?? null,
    sex: chosen.sex === "male" || chosen.sex === "female" ? chosen.sex : null,
    canLog: state.child.access === "manage",
  };
  const emergencyNumber = normaliseCrisisCard(card).emergencyNumber;

  return (
    <div className="space-y-6">
      {header}
      <h2 className="text-2xl font-extrabold">{child.firstName}</h2>
      {state.choices.length > 1 && (
        <ChildSwitchLink accountId={profile.id} href="/patient/child" className="text-sm font-semibold underline">{t("cdl.whose.switch")}</ChildSwitchLink>
      )}
      <ChildLogPanel accountId={profile.id} child={child} emergencyNumber={emergencyNumber} />
      {child.canLog && (
        <PrivateSection key={child.id} accountId={profile.id} title={t("cdl.mother.section")}>
          <p className="text-sm">{t("cdl.mother.help")}</p>
          <Link href="/patient/womens-health" className="font-semibold underline">{t("cdl.mother.open_mood_check")}</Link>
        </PrivateSection>
      )}
    </div>
  );
}
