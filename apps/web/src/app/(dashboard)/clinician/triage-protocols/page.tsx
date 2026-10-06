import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { TriageProtocolsPanel } from "../_signoff-panels/triage-protocols-panel";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to the
 * Symptom Assessment & Triage Engine's governed protocol config (platform
 * brief §37). Mirrors /clinician/team-caseload's pattern, not
 * /clinician/emergency-access-review's: `admin/settings/triage-protocols/
 * page.tsx` hard-redirects anyone whose `profiles.role !== "admin"`, and
 * proxy.ts's /admin/* gate refuses a plain `clinician` login before that
 * page would even load — so a real CMO (account role always `clinician`,
 * per CLAUDE.md's "never re-split the account role" rule) could not reach
 * this at all. Reuses TriageProtocolsManager as-is (its `createTriage
 * ProtocolDraftAction`/`signTriageProtocolsAction` server actions live in
 * admin/settings/triage-protocols/actions.ts, dual-gated 2026-09-14 to admin
 * OR an active Clinical Director — see that file's comment; the sign action
 * was already Clinical-Director-gated at the DB level and untouched here).
 * Found and audited 2026-09-14.
 */
export default async function ClinicianTriageProtocolsPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Symptom Triage Protocols"
        description="The red-flag screening rules and dynamic question trees behind the patient-facing symptom checker (platform brief §37): what counts as an emergency, what needs a prompt clinical look, and what's safe to self-manage, for each presenting complaint. Content changes only through a reviewed, tested migration; this page is where a Clinical Director puts a signed record on file and turns the patient-facing checker on."
      />
      <TriageProtocolsPanel />
    </div>
  );
}
