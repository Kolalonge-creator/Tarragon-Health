import { getCurrentProfile } from "@/lib/auth/current-profile";
import { CaseWorklist } from "./case-worklist";

/**
 * Module 74 — chronic disease case management worklist. Active cases +
 * candidates who aren't in one yet (74.7): high-risk patients per the
 * existing public.high_risk_patient_ids() roster filter. Opening a case is
 * always a deliberate action here — nothing on this page auto-opens one.
 * Detail view: ./[caseId].
 */
export default async function CaseManagementPage() {
  const profile = await getCurrentProfile();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Case management</h1>
        <p className="text-sm text-charcoal-ink/60">
          Intensive management for patients whose conditions need ongoing coordination — multiple
          conditions, uncontrolled disease, repeated hospitalisation, high predicted risk, complex
          medication, or significant barriers.
        </p>
      </div>
      <CaseWorklist organisationId={profile?.organisation_id ?? ""} />
    </div>
  );
}
