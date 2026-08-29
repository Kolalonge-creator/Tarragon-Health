import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { AlertRulesManager, type AlertRulesVersionRow } from "./alert-rules-manager";

/**
 * Clinical Director sign-off for `alert_rules` (20260828013011) — spec
 * §31.13's escalation policy per alert type: who receives it, response
 * timeframe, backup person, escalation route, and maximum delay.
 *
 * This table shipped with the rest of the Alert System taxonomy but no app
 * code ever reached it: no admin could see the config, and nothing ever
 * called public.sign_alert_rules(). Mirrors admin/settings/escalation-slas
 * exactly, down to the "numbers change only through a migration, this page
 * only signs" posture.
 */
export default async function AlertRulesSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: versions } = await supabase
    .from("alert_rules")
    .select("id, version, config, notes, is_active, approved_at, created_at")
    .order("version", { ascending: false });

  const versionRows = (versions as AlertRulesVersionRow[] | null) ?? [];
  const activeVersion = versionRows.find((v) => v.is_active) ?? null;
  const nextVersion = (versionRows[0]?.version ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Alert rules</h1>
        <p className="text-charcoal-ink/60">
          The ownership, routing, and response-time policy every clinical, care-management,
          medication, and operational alert is governed by — who owns it, who backs them up, how
          long before it escalates, and which channels carry it. This drives the ack-timeout ladder
          and severity/routing for every clinician_alert on the platform. The policy changes only
          through a reviewed, tested migration; this page is where a Clinical Director puts a signed
          record on file confirming the active configuration has been reviewed and approved.
        </p>
      </div>
      <AlertRulesManager
        versions={versionRows}
        activeVersion={activeVersion}
        nextVersion={nextVersion}
      />
    </div>
  );
}
