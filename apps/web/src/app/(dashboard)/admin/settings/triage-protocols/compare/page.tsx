import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { ProtocolCompare } from "@/components/triage/protocol-compare";

export const metadata = { title: "Compare triage protocol versions" };
export const dynamic = "force-dynamic";

/** S80d (25.2): the admin door to the same read-only comparison. */
export default async function AdminCompareTriageProtocolsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const { from, to } = await searchParams;
  return (
    <div className="space-y-6">
      <PageHeader title="Compare triage protocol versions" description="See what changed between two versions of the symptom triage rules, and replay the same cases against both. This page only reads: it never signs, switches on or edits a version." />
      <ProtocolCompare basePath="/admin/settings/triage-protocols/compare" from={from} to={to} />
    </div>
  );
}
