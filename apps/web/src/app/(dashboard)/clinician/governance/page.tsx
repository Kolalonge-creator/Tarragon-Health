import Link from "next/link";
import { figure } from "@tarragon/shared";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { loadGovernanceSignals } from "@/lib/leadership/load-governance-signals";
import { getCmoSigningHubForRequest } from "@/lib/queries/cmo-signing-hub-request";
import { getTestPatientIdsForRequest } from "@/lib/queries/real-patients-request";
import { CLINICIAN_GOVERNANCE_SECTIONS } from "@/lib/navigation";
import { createClient } from "@/lib/supabase/server";
import { TodayStrip } from "../today-strip";
import { GovernanceIndex } from "./governance-index";

export const metadata = { title: "Governance" };

/**
 * DW-02 (2026-11-06): one door to quality, oversight, AI, rules and operations pages that used to fill the
 * doctor's sidebar. The list is CLINICIAN_GOVERNANCE_SECTIONS, the same list the CMO's search indexes.
 *
 * CMO command centre (2026-11-07): the Chief Medical Officer also sees the four open governance counts at the top, read live
 * under their own RLS, each linking to its page. A count whose read failed shows "could not be loaded", never 0.
 */
export default async function ClinicianGovernancePage() {
  const staff = await getCurrentClinicalStaff();
  const isCmo = canAssignCases(staff);
  let strip: React.ReactNode = null;
  if (isCmo) {
    const [supabase, testPatientIds] = await Promise.all([createClient(), getTestPatientIdsForRequest()]);
    const [signals, hub] = await Promise.all([loadGovernanceSignals(supabase, testPatientIds), getCmoSigningHubForRequest().catch(() => null)]);
    strip = (
      <section aria-labelledby="gov-open-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="gov-open-heading" className="font-heading text-lg font-semibold text-charcoal-ink">
            Open now
          </h2>
          <Link href="/clinician/leadership" className="text-sm font-medium text-brand-green underline">
            Leadership overview
          </Link>
        </div>
        <TodayStrip
          label="Open governance items"
          tiles={[
            { label: "Waiting for your signature", figure: figure(hub?.items.length ?? null, hub === null || hub.failed), href: "/clinician/clinical-signoff", note: "sign-off items" },
            { label: "Clinical incidents", figure: figure(signals.incidents?.length ?? null, signals.incidents === null), href: "/clinician/safety-incidents", note: "not closed" },
            { label: "Safeguarding concerns", figure: figure(signals.safeguarding?.length ?? null, signals.safeguarding === null), href: "/clinician/safeguarding", note: "open or in review" },
            { label: "Complaints", figure: figure(signals.complaints?.length ?? null, signals.complaints === null), href: "/clinician/complaints", note: "before governance review" },
          ]}
        />
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance"
        description="Quality, clinical oversight, AI, rules and operations. Some pages are for the Chief Medical Officer only and say so when opened. Anything you must sign is on the Sign-off hub."
      />
      {strip}
      <GovernanceIndex sections={CLINICIAN_GOVERNANCE_SECTIONS} />
    </div>
  );
}
