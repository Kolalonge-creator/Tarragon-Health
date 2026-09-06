import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import { SexualHealthWorklist } from "./sexual-health-worklist";

/**
 * Sexual & reproductive health worklist (spec §47.5/§47.6/§47.7/§47.8): open
 * STI case episodes, pending emergency contraception requests, and requested
 * contraception plans — org-scoped the same way as Escalations/Referrals
 * (client-side react-query hooks relying on RLS's is_org_staff check, not a
 * page-level fetch), since every one of these tables already restricts
 * reads/writes to the caller's own org with no broader visibility to gate
 * here. Every actual UPDATE goes through the caller's own authenticated
 * session; the DB's own transition triggers
 * (enforce_sti_case_episode_transition, enforce_ec_request_update,
 * enforce_contraception_plan_update) are the real authority, deriving
 * reviewed_by/treated_by/prescribed_by server-side — see actions.ts, which
 * never sets those columns directly.
 */
export default function ClinicianSexualHealthPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Sexual health cases"
        icon={SEMANTIC_ICON.escalation}
        description="Open STI cases, emergency contraception requests, and contraception requests awaiting review."
      />
      <SexualHealthWorklist />
    </div>
  );
}
