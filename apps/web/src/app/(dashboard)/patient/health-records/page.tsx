import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { groupByPipeline, loadRecordItems, PATIENT_STATUS, PIPELINE_GROUP } from "@/lib/clinical-documents/record-items";
import { UnsortedDocuments } from "@/app/(dashboard)/patient/unsorted-documents";

export const metadata = { title: "My Health Records" };
export const dynamic = "force-dynamic";

/**
 * My Health Records (CDE-07, clinical document engine step 6): every document on the record in one place, whatever kind and however
 * it arrived (your own upload, the care team, a laboratory). It reads the same list the doctors see (clinical_record_items), so the
 * two cannot disagree about what exists. Results with values stay on their own pages (Labs & results), where a doctor releases them.
 */
export default async function HealthRecordsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { subjectId } = await getPatientDashboardContext();
  const { show } = await searchParams;
  const user = await getCurrentUser();
  if (user?.id !== subjectId) {
    // Uploaded documents are shown to the account holder only (clinical_documents RLS); say so rather than "nothing here".
    return (
      <div className="space-y-6">
        <PageHeader backTo={{ href: "/patient/my-health", label: "My Health" }} title="My Health Records" icon={NAV_ICON.passport} />
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Uploaded reports and documents are shown only to the person whose record it is. Their results you can see are on Labs &amp; results.
        </p>
      </div>
    );
  }
  const supabase = await createClient();
  const items = await loadRecordItems(supabase, subjectId);
  const groups = groupByPipeline(items);
  const shown = show && PIPELINE_GROUP[show] ? groups.filter((g) => g.pipeline === show) : groups;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/my-health", label: "My Health" }}
        title="My Health Records"
        icon={NAV_ICON.passport}
        description="Every report and document on your record: test results, scans, heart tests, letters and anything you have uploaded."
      />

      <UnsortedDocuments patientId={subjectId} />

      {groups.length > 1 && (
        <nav aria-label="Show one kind" className="flex flex-wrap gap-2 text-sm">
          <Link href="/patient/health-records" className={`rounded-full border px-3 py-1 ${!show ? "border-brand-green font-medium" : ""}`}>All</Link>
          {groups.map((g) => (
            <Link key={g.pipeline} href={`/patient/health-records?show=${g.pipeline}`} className={`rounded-full border px-3 py-1 ${show === g.pipeline ? "border-brand-green font-medium" : ""}`}>
              {g.label} ({g.items.length})
            </Link>
          ))}
        </nav>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Nothing here yet. Documents you or your care team add will appear here.</p>
      ) : (
        shown.map((g) => (
          <Card key={g.pipeline}>
            <CardHeader>
              <CardTitle>{g.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {g.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{i.kind_label ?? "Document"}{i.original_filename ? <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60"> · {i.original_filename}</span> : null}</p>
                      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                        {i.investigation_date ? `Test date ${formatPatientDate(i.investigation_date)} · ` : ""}Added {formatPatientDate(i.uploaded_at ?? "")} · {PATIENT_STATUS[i.status ?? ""] ?? i.status}
                      </p>
                    </div>
                    {i.signedUrl ? (
                      <a href={i.signedUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-brand-green hover:underline dark:text-brand-green-bright">Open</a>
                    ) : i.routed_table === "lab_result_files" ? (
                      <Link href="/patient/labs" className="text-sm font-medium text-brand-green hover:underline dark:text-brand-green-bright">See the result</Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
