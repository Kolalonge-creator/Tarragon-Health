import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ProtocolDraftsManager } from "@/app/(dashboard)/admin/settings/protocols/protocol-drafts-manager";
import { ProtocolVersionsManager } from "@/app/(dashboard)/admin/settings/protocols/protocol-versions-manager";

/**
 * The Chief Medical Officer / Clinical Director's own reachable path to the
 * version-signed protocol record behind every "protocols supervised by
 * Dr. X" claim shown to patients (docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4).
 * Mirrors the /clinician/team-caseload pattern (2026-08-31), not the
 * /clinician/emergency-access-review one: `admin/settings/protocols/page.tsx`
 * hard-redirects anyone whose `profiles.role !== "admin"`, with no tier
 * fallback, and proxy.ts's /admin/* route gate refuses a plain `clinician`
 * login before that page would even load — so a real CMO (whose account
 * role is always `clinician`, never `admin`, per CLAUDE.md's "never
 * re-split the account role" rule) could not reach it at all. Reuses the
 * exact same manager components the admin page renders rather than
 * duplicating them: both write through `@/lib/queries/protocol-drafts` /
 * `@/lib/queries/protocol-versions`, which call Supabase directly under RLS
 * (`protocol_drafts`/`protocol_draft_comments` already allow any
 * clinical-tier insert via `private.is_clinical_tier`, and
 * `promote_protocol_draft`/`reject_protocol_draft` are SECURITY DEFINER
 * RPCs) — there was no admin-only gate left in the data path once this
 * page's own access check let a CMO through. Found and audited 2026-09-14.
 */
export default async function ClinicianProtocolsPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clinical protocols"
        description={`The version-signed record behind every "protocols supervised by Dr. X" claim shown to patients: docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4. Append-only: signing a new version is how a protocol changes, nothing here is ever edited after the fact. Only the org's active Clinical Director can sign.`}
      />
      <ProtocolDraftsManager />
      <ProtocolVersionsManager />
    </div>
  );
}
