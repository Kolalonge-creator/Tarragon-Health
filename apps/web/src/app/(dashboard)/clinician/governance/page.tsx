import { PageHeader } from "@/components/ui/page-header";
import { CLINICIAN_GOVERNANCE_SECTIONS } from "@/lib/navigation";
import { GovernanceIndex } from "./governance-index";

export const metadata = { title: "Governance" };

/**
 * DW-02 (2026-11-06): one door to quality, oversight, AI, rules and operations pages that used to fill the
 * doctor's sidebar. The list is CLINICIAN_GOVERNANCE_SECTIONS, the same list the CMO's search indexes.
 */
export default function ClinicianGovernancePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance"
        description="Quality, clinical oversight, AI, rules and operations. Some pages are for the Chief Medical Officer only and say so when opened. Anything you must sign is on the Sign-off hub."
      />
      <GovernanceIndex sections={CLINICIAN_GOVERNANCE_SECTIONS} />
    </div>
  );
}
