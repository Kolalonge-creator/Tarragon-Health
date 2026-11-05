import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { ROLE_DISPLAY_LABEL } from "@/lib/auth/roles";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { TwoFactorManager, type TwoFactorGroupRow, type TwoFactorChangeRow } from "./two-factor-manager";
import { MfaResetPanel, type EnrolledAccountRow } from "./mfa-reset-panel";

export const metadata = { title: "Two-factor sign-in" };

/**
 * Require two-factor sign-in (2FA) for a whole group of accounts with one switch (migration 20261105110919). Every group ships
 * OFF. An operational setting under docs/design/GATE-MODEL.md: versioned, audited, a change note, no CMO signature.
 *
 * Admin only (not delegated through the permission system): the switch decides who can reach patient data at all. The database
 * function behind it checks again and carries the lock-out guards; see the migration header.
 */
export default async function TwoFactorSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect("/admin");

  const supabase = await createClient();
  const [{ data: groups, error: groupsError }, { data: changes }, { data: enrolled }, { data: resets }] = await Promise.all([
    supabase.rpc("admin_mfa_group_requirements"),
    supabase.rpc("admin_mfa_group_requirement_changes", { p_limit: 30 }),
    supabase.rpc("admin_mfa_enrolled_accounts", { p_search: null }),
    supabase.rpc("admin_mfa_factor_resets", { p_limit: 20 }),
  ]);
  const accounts: EnrolledAccountRow[] = (enrolled ?? []).map((a) => ({
    ...a,
    roleLabel: a.doctor_tier
      ? `${ROLE_DISPLAY_LABEL[a.role] ?? a.role}, ${DOCTOR_TIER_LABEL[a.doctor_tier] ?? a.doctor_tier}`
      : (ROLE_DISPLAY_LABEL[a.role] ?? a.role),
  }));

  const rows: TwoFactorGroupRow[] = (groups ?? []).map((g) => ({
    ...g,
    label:
      g.role === "patient"
        ? "Patients and supporters"
        : g.doctor_tier
          ? `${ROLE_DISPLAY_LABEL[g.role] ?? g.role}: ${DOCTOR_TIER_LABEL[g.doctor_tier] ?? g.doctor_tier} only`
          : (ROLE_DISPLAY_LABEL[g.role] ?? g.role),
  }));
  const history: TwoFactorChangeRow[] = (changes ?? []).map((c) => ({
    ...c,
    label:
      c.role === "patient"
        ? "Patients and supporters"
        : c.doctor_tier
          ? `${ROLE_DISPLAY_LABEL[c.role] ?? c.role}: ${DOCTOR_TIER_LABEL[c.doctor_tier] ?? c.doctor_tier} only`
          : (ROLE_DISPLAY_LABEL[c.role] ?? c.role),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Two-factor sign-in"
        description="Require a code from an authenticator app at sign-in for a whole group of accounts. Every group starts optional. When a group is required, anyone in it without 2FA is sent to Profile & settings to set it up before they can use anything else, and anyone with it must enter the code at each sign-in, including with Google."
      />
      <TwoFactorManager groups={rows} history={history} loadFailed={groupsError !== null} />
      <MfaResetPanel accounts={accounts} resets={resets ?? []} currentUserId={profile.id} />
    </div>
  );
}
