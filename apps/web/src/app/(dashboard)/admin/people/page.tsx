import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { attentionWindows, buildAttention, buildKpis, countBy, isCurrentStaff, lagosToday, sortAttention, type Priority } from "@/lib/people/attention";
import { loadTrainingRecords, summarise, trainingAttention } from "@/lib/people/training";
import { loadDirectory, loadRecentActivity, PATTERN_LABEL, ROLE_LABEL, STATUS_LABEL } from "@/lib/people/directory";
import { formatDate, PeopleNav } from "./people-nav";

export const metadata = { title: "People and HR" };
export const dynamic = "force-dynamic";

const PRIORITY_BADGE: Record<Priority, "critical" | "attention" | "info"> = { high: "critical", medium: "attention", low: "info" };
const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };

const ACTIVITY_LABEL: Record<string, string> = {
  "staff_department.created": "Department added",
  "staff_department.updated": "Department changed",
  "staff_personal_details.updated": "Personal details updated",
  "staff_employment.appointment": "Appointment recorded",
  "staff_employment.promotion": "Promotion recorded",
  "staff_employment.transfer": "Department transfer recorded",
  "staff_employment.manager_change": "Line manager changed",
  "staff_employment.hours_change": "Hours changed",
  "staff_employment.contract_renewal": "Contract renewed",
  "staff_employment.contract_amendment": "Contract amended",
  "staff_employment.suspension": "Suspension recorded",
  "staff_employment.return_to_work": "Return to work recorded",
  "staff_employment.termination": "Termination recorded",
  "staff_employment.resignation": "Resignation recorded",
  "staff_employment.retirement": "Retirement recorded",
  "staff_employment.correction": "Employment record corrected",
  "staff_training_course.created": "Training course added",
  "staff_training_course.updated": "Training course changed",
  "staff_training_requirement.added": "Training requirement added",
  "staff_training_requirement.removed": "Training requirement removed",
  "staff_training_requirement.due_changed": "Training due period changed",
  "staff_training_completion.recorded": "Training completion recorded",
  "staff_training_completion.verified": "Training completion verified",
  "staff_training_completion.voided": "Training record voided",
};

/**
 * HR command centre (HR Phase A, docs/design/HR-WORKFORCE.md; decisions HR-01, HR-02). Admin only. Everything shown comes
 * from real records: employment history, account state and the clinician licence and indemnity dates on clinical_staff.
 * Training, leave and supervision are not recorded yet and say so, rather than showing a made-up number.
 */
export default async function PeopleOverviewPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const [directory, activity, training] = await Promise.all([loadDirectory(supabase), loadRecentActivity(supabase), loadTrainingRecords(supabase)]);

  if (!directory.ok) {
    return <p className="text-sm text-red-700">{directory.message}</p>;
  }
  const today = lagosToday();
  const rows = directory.value.filter((r) => !r.is_test);
  const windows = attentionWindows();
  const people = new Map(rows.map((r) => [r.profile_id, { name: r.full_name ?? "Unnamed account", department: r.department_name }]));
  const trainingItems = training.ok ? trainingAttention(training.value, people, today, windows.training_warn_days) : [];
  const attention = sortAttention([...buildAttention(rows, today, windows), ...trainingItems]);
  const kpis = buildKpis(rows, attention);
  const trainingSummary = training.ok ? summarise(training.value, today, windows.training_warn_days) : null;
  const current = rows.filter((r) => isCurrentStaff(r) && r.account_active);
  const testCount = directory.value.length - rows.length;

  const tiles: Array<{ label: string; value: string; href?: string; note?: string }> = [
    { label: "Active staff", value: String(kpis.activeStaff), href: "/admin/people/directory" },
    { label: "Active clinical staff", value: String(kpis.activeClinical), href: "/admin/people/directory?clinical=clinical" },
    { label: "Active non-clinical staff", value: String(kpis.activeNonClinical), href: "/admin/people/directory?clinical=non_clinical" },
    { label: "Onboarding", value: String(kpis.onboarding), href: "/admin/people/directory?status=onboarding" },
    { label: "Credentials needing attention", value: String(kpis.credentialsNeedingAttention), href: "/admin/credentialing/expiry" },
    trainingSummary === null
      ? { label: "Mandatory training", value: "Could not load", href: "/admin/people/training" }
      : trainingSummary.required === 0
        ? { label: "Mandatory training", value: "None required yet", href: "/admin/people/training", note: "Add courses and who must do them." }
        : { label: "Mandatory training met", value: `${trainingSummary.compliant} of ${trainingSummary.required}`, href: "/admin/people/training",
            note: trainingSummary.overdue > 0 ? `${trainingSummary.overdue} overdue` : undefined },
    { label: "Outstanding supervision", value: "Not tracked yet", note: "Comes with supervision records (Phase D)." },
    { label: "Leave awaiting approval", value: "Not tracked yet", note: "Comes with leave requests (Phase C)." },
  ];

  const composition = [
    { title: "By department", data: countBy(current, (r) => r.department_name) },
    { title: "Clinical and non-clinical", data: countBy(current, (r) => (r.is_clinician ? "Clinical" : "Non-clinical")) },
    { title: "By account role", data: countBy(current, (r) => ROLE_LABEL[r.role] ?? r.role) },
    { title: "Employed or contracted", data: countBy(current, (r) => (r.engagement === "employed" ? "Employed" : r.engagement === "contracted" ? "Contracted" : null)) },
    { title: "Working pattern", data: countBy(current, (r) => (r.work_pattern ? PATTERN_LABEL[r.work_pattern] : null)) },
    { title: "Employment status", data: countBy(current, (r) => (r.employment_status ? STATUS_LABEL[r.employment_status] : null)) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="People and HR"
        description="Who works for Tarragon, what they do, who they report to, and what needs attention. Platform access stays on Members; clinician credentials stay in credentialing."
      />
      <PeopleNav active="/admin/people" />

      <Card>
        <CardHeader><CardTitle>Workforce and compliance attention</CardTitle></CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">Nothing needs attention.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Person</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Issue</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Priority</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Due</th>
                    <th scope="col" className="py-2 font-medium">Next step</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {attention.map((a) => (
                    <tr key={`${a.kind}-${a.profileId}`}>
                      <td className="py-2 pr-3">
                        <Link href={`/admin/people/${a.profileId}`} className="font-medium underline-offset-4 hover:underline">{a.name}</Link>
                        {a.department && <span className="block text-xs text-charcoal-ink/60">{a.department}</span>}
                      </td>
                      <td className="py-2 pr-3">{a.issue}</td>
                      <td className="py-2 pr-3"><Badge variant={PRIORITY_BADGE[a.priority]}>{PRIORITY_LABEL[a.priority]}</Badge></td>
                      <td className="py-2 pr-3">{a.due ? formatDate(a.due) : "None"}</td>
                      <td className="py-2"><Link href={a.href} className="text-brand-green underline-offset-4 hover:underline">{a.nextAction}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-label="Headline figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const body = (
            <>
              <p className="text-sm text-charcoal-ink/70">{t.label}</p>
              <p className="mt-1 text-2xl font-semibold">{t.value}</p>
              {t.note && <p className="mt-1 text-xs text-charcoal-ink/60">{t.note}</p>}
            </>
          );
          return t.href ? (
            <Link key={t.label} href={t.href} className="rounded-lg border p-4 hover:bg-charcoal-ink/5">{body}</Link>
          ) : (
            <div key={t.label} className="rounded-lg border p-4">{body}</div>
          );
        })}
      </section>

      <Card>
        <CardHeader><CardTitle>Workforce composition</CardTitle></CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {composition.map((c) => (
            <div key={c.title}>
              <h3 className="mb-2 text-sm font-medium">{c.title}</h3>
              {c.data.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">No current staff.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {c.data.map((d) => (
                    <li key={d.label}>
                      <div className="flex justify-between gap-2"><span>{d.label}</span><span className="tabular-nums">{d.count}</span></div>
                      <div className="mt-0.5 h-1.5 rounded bg-charcoal-ink/10" aria-hidden>
                        <div className="h-1.5 rounded bg-brand-green" style={{ width: `${Math.round((d.count / current.length) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent HR activity</CardTitle></CardHeader>
        <CardContent>
          {!activity.ok ? (
            <p className="text-sm text-red-700">{activity.message}</p>
          ) : activity.value.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">No HR changes recorded yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {activity.value.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {ACTIVITY_LABEL[a.action] ?? a.action}
                    {a.subject_profile_id && a.subject_name && (
                      <> for <Link href={`/admin/people/${a.subject_profile_id}`} className="underline-offset-4 hover:underline">{a.subject_name}</Link></>
                    )}
                  </span>
                  <span className="text-charcoal-ink/60">{a.actor_name}, {formatDate(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!training.ok && <p className="text-sm text-red-700">{training.message} Training items are missing from the list above.</p>}

      {testCount > 0 && (
        <p className="text-xs text-charcoal-ink/60">{testCount} test {testCount === 1 ? "account is" : "accounts are"} left out of these figures.</p>
      )}
    </div>
  );
}
