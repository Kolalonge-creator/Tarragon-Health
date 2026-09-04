import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { ReportDocument } from "./report-document";
import { SignOffPanel } from "./sign-off-panel";
import { PrintButton } from "./print-button";
import type { BoardReportRow } from "@/lib/payer/board-report";

export const metadata: Metadata = {
  title: "Outcomes report",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * One issued report, rendered as the document it is.
 *
 * RLS decides visibility: payer_board_reports_select admits only an active
 * payer administrator for this report's insurer (and Tarragon superadmin).
 * There is no organisation filter to add here and no ownership check to write
 * — a row this session cannot see simply does not come back, and that is the
 * check.
 */
export default async function BoardReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .from("payer_board_reports")
    .select(
      "id, report_number, period_start, period_end, status, content_hash, generated_at, attested_at, attestation_statement, attester_role_title, withdrawal_reason, snapshot"
    )
    .eq("id", reportId)
    .maybeSingle();

  if (!data) notFound();
  const report = data as unknown as BoardReportRow;

  // Attestation and withdrawal are Tarragon-side acts. The database refuses
  // them for anyone else regardless; this only decides whether to render the
  // controls at all, so a payer is not shown a button that will reject them.
  const profile = await getCurrentProfile();
  const isTarragonAdmin = profile?.role === "admin";

  const verifyUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://tarragonhealth.ng"}/verify-report`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/payer/board-report" className="text-sm text-charcoal-ink/70 hover:underline">
          ← All outcomes reports
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-xl border border-charcoal-ink/10 shadow-sm print:border-0 print:shadow-none">
        <ReportDocument report={report} verifyUrl={verifyUrl} />
      </div>

      {isTarragonAdmin && <SignOffPanel report={report} />}
    </div>
  );
}
