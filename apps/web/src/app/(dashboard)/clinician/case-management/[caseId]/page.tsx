import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { CaseDetail } from "./case-detail";

/**
 * One care_management_cases episode — 74.4's case file (conditions/
 * medications/investigations/specialists/hospitalisations, read live from
 * their own existing tables — never duplicated), care goals, case plan
 * (74.6), barriers, and the lifecycle actions (assign case manager,
 * escalate, close, reopen). canClose mirrors close_care_management_case's
 * own server-side gate (private.is_clinical_tier) so a Care Coordinator
 * sees why the button is disabled rather than a raw RPC error.
 */
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const staff = await getCurrentClinicalStaff();
  const canClose = isClinicalTier(staff);

  return <CaseDetail caseId={caseId} canClose={canClose} />;
}
