import { redirect } from "next/navigation";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { isClinicalTier } from "@/lib/clinical/doctor-tier";
import { PageHeader } from "@/components/ui/page-header";
import { ProtocolCompare } from "@/components/triage/protocol-compare";

export const metadata = { title: "Compare triage protocol versions" };
export const dynamic = "force-dynamic";

/** S80d (25.2): read-only comparison of two symptom triage protocol versions, for any clinical-tier doctor and the Chief Medical Officer. */
export default async function CompareTriageProtocolsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!isClinicalTier(staff)) redirect("/clinician");
  const { from, to } = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Compare triage protocol versions" description="See what changed between two versions of the symptom triage rules, and replay the same cases against both. This page only reads: it never signs, switches on or edits a version." />
      <ProtocolCompare basePath="/clinician/triage-protocols/compare" from={from} to={to} />
    </div>
  );
}
