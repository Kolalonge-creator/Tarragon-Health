import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { EscalationSlasPanel } from "../_signoff-panels/escalation-slas-panel";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to
 * sign-off on the escalation_slas config — the single source of truth
 * CLAUDE.md names for the live abnormal-result contact-time commitment.
 * Mirrors /clinician/protocols' pattern exactly: admin/settings/
 * escalation-slas/page.tsx hard-redirects anyone whose `profiles.role !==
 * "admin"`, and proxy.ts's /admin/* gate refuses a plain `clinician` login
 * before that page would even load — so a real CMO (account role always
 * `clinician`) could not reach this at all, even though
 * sign_escalation_slas has always been Clinical-Director-only, never admin.
 * Found 2026-09-22, same audit that found escalation_slas_insert was
 * admin-only RLS with no CMO fallback — fixed in
 * 20260922193027_cmo_governed_config_insert_dual_gate.sql, which this page
 * depends on for the "draft a new version" form to work.
 */
export default async function ClinicianEscalationSlasPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Escalation SLAs"
        description='The contact-time commitment every clinician_alert is raised against, by care pathway and urgency tier. This drives sla_due_at on every abnormal-result, red-flag-vitals, emergency, and "silence is not assumed safe" alert on the platform. The numbers change only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file confirming the active configuration has been reviewed and approved.'
      />
      <EscalationSlasPanel />
    </div>
  );
}
