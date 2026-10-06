import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { AlertRulesPanel } from "../_signoff-panels/alert-rules-panel";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the unified alert taxonomy. Mirrors /clinician/protocols'
 * pattern exactly: `admin/settings/alert-rules/page.tsx` hard-redirects
 * anyone whose `profiles.role !== "admin"`, and proxy.ts's /admin/* gate
 * refuses a plain `clinician` login before that page would even load — so a
 * real CMO (account role always `clinician`) could not reach this at all,
 * even though sign_alert_rules has always been Clinical-Director-only,
 * never admin. Found 2026-09-22, same audit that found alert_rules_insert
 * was admin-only RLS with no CMO fallback — fixed in
 * 20260922193027_cmo_governed_config_insert_dual_gate.sql, which this page
 * depends on for the "draft a new version" form to work.
 */
export default async function ClinicianAlertRulesPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Rules"
        description="The severity, owner tier, ack timeout, and delivery channels for every clinician alert type on the platform — abnormal results, vitals red flags, symptom escalation, medication safety, care-management follow-ups, and more. Content changes only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file."
      />
      <AlertRulesPanel />
    </div>
  );
}
