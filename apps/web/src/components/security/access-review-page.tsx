import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { dueForReview, loadAccessReview, loadRecentOpens, loadRetentionReport } from "@/lib/security/access-review";

function Failed({ message }: { message: string }) {
  return <p className="text-sm text-red-700">Could not load this: {message}</p>;
}

/** Who opened which patient records (S39c) and what the retention review sees (S39d). Read only; admins and the Chief Medical Officer. */
export async function AccessReviewPage() {
  const supabase = await createClient();
  const [review, opens, retention] = await Promise.all([loadAccessReview(supabase, 7), loadRecentOpens(supabase, 50), loadRetentionReport(supabase)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Record access review</h1>
        <p className="text-sm text-charcoal-ink/60">
          Every time a clinician opens a patient record it is logged and cannot be edited. Patients are not shown this. Untied means the clinician is not on the patient&apos;s care team.
        </p>
      </div>
      <Card>
        <CardHeader><CardTitle>Last 7 days, per clinician</CardTitle></CardHeader>
        <CardContent>
          {!review.ok ? <Failed message={review.message} /> : review.rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">No records were opened in this period.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Clinician</th><th>Openings</th><th>Untied</th><th>After hours</th><th>Patients</th></tr></thead>
              <tbody>
                {review.rows.map((r) => (
                  <tr key={r.staff_id}><td>{r.staff_name}</td><td>{r.openings}</td><td>{r.untied_openings}</td><td>{r.after_hours_openings}</td><td>{r.distinct_patients}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Latest 50 openings</CardTitle></CardHeader>
        <CardContent>
          {!opens.ok ? <Failed message={opens.message} /> : opens.rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">Nothing logged yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>When</th><th>Clinician</th><th>Patient</th><th>Basis</th><th>After hours</th></tr></thead>
              <tbody>
                {opens.rows.map((o) => (
                  <tr key={o.id}><td>{new Date(o.opened_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}</td><td className="font-mono text-xs">{o.staff_id.slice(0, 8)}</td><td className="font-mono text-xs">{o.patient_id.slice(0, 8)}</td><td>{o.basis}</td><td>{o.after_hours ? "yes" : ""}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Retention review (report only, nothing is deleted)</CardTitle></CardHeader>
        <CardContent>
          {!retention.ok ? <Failed message={retention.message} /> : dueForReview(retention.rows).length === 0 ? <p className="text-sm text-charcoal-ink/60">No rows are older than their retention period yet.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th>Table</th><th>Class</th><th>Period</th><th>Older rows</th></tr></thead>
              <tbody>
                {dueForReview(retention.rows).map((r) => (
                  <tr key={r.table_name}><td>{r.table_name}</td><td>{r.retention_class}</td><td>{r.period}</td><td>{r.rows_older_than_period}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-charcoal-ink/60">Rows are counted by age. A record is only due once the patient&apos;s last contact is older than the period, so review before acting.</p>
        </CardContent>
      </Card>
    </div>
  );
}
