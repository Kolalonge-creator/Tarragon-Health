import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { attentionWindows, lagosToday } from "@/lib/people/attention";
import { loadDepartments, loadDirectory, ROLE_LABEL } from "@/lib/people/directory";
import {
  loadCourses,
  loadRequirements,
  loadTrainingRecords,
  summarise,
  TRAINING_STATUS_BADGE as STATUS_BADGE,
  TRAINING_STATUS_LABEL,
  trainingDueDate,
  trainingStatus,
} from "@/lib/people/training";
import { formatDate, PeopleNav } from "../people-nav";
import { CourseForm, DueDaysForm, RemoveRequirementButton, RequirementForm } from "../training-forms";

export const metadata = { title: "Training" };
export const dynamic = "force-dynamic";

/**
 * Training (HR Phase B). Admin only. The course catalogue, who must do what, and every current staff member's status on each
 * required course. Statuses come from verified records only; counts are shown plainly, never as one blended score.
 */
export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const [courses, requirements, records, directory, departments] = await Promise.all([
    loadCourses(supabase),
    loadRequirements(supabase),
    loadTrainingRecords(supabase),
    loadDirectory(supabase),
    loadDepartments(supabase),
  ]);
  for (const r of [courses, requirements, records, directory, departments]) if (!r.ok) return <p className="text-sm text-red-700">{r.message}</p>;
  if (!courses.ok || !requirements.ok || !records.ok || !directory.ok || !departments.ok) return null;

  const today = lagosToday();
  const warn = attentionWindows().training_warn_days;
  const names = new Map(directory.value.map((p) => [p.profile_id, p.full_name ?? "Unnamed account"]));
  const courseName = new Map(courses.value.map((c) => [c.id, c.name]));
  const deptName = new Map(departments.value.map((d) => [d.id, d.name]));
  const rows = records.value
    .map((r) => ({ r, status: trainingStatus(r, today, warn) }))
    .filter((x) => !sp.status || x.status === sp.status)
    .sort((a, b) => (names.get(a.r.profile_id) ?? "").localeCompare(names.get(b.r.profile_id) ?? "") || a.r.course_name.localeCompare(b.r.course_name));
  const s = summarise(records.value, today, warn);

  const target = (q: (typeof requirements.value)[number]) =>
    q.applies_to === "everyone" ? "Everyone" : q.applies_to === "role" ? `Role: ${ROLE_LABEL[q.role ?? ""] ?? q.role}` : `Department: ${deptName.get(q.department_id ?? "") ?? "Unknown"}`;

  return (
    <div className="space-y-6">
      <PageHeader title="Training" description="Mandatory and professional training: what each person must do, and whether a verified record shows it is done." />
      <PeopleNav active="/admin/people/training" />

      <section aria-label="Mandatory training figures" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Mandatory requirements met", value: `${s.compliant} of ${s.required}`, status: "compliant" },
          { label: "Overdue", value: String(s.overdue), status: "overdue" },
          { label: "Waiting for verification", value: String(s.pendingVerification), status: "pending_verification" },
          { label: "Due soon", value: String(s.dueSoon), status: "due_soon" },
        ].map((t) => (
          <Link key={t.label} href={`/admin/people/training?status=${t.status}`} className="rounded-lg border p-4 hover:bg-charcoal-ink/5">
            <p className="text-sm text-charcoal-ink/70">{t.label}</p>
            <p className="mt-1 text-2xl font-semibold">{t.value}</p>
          </Link>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            Who has done what
            {sp.status && (
              <Link href="/admin/people/training" className="ml-3 text-sm font-normal text-brand-green underline-offset-4 hover:underline">
                Show everyone
              </Link>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">
              {records.value.length === 0 ? "No training is required of anyone yet. Add a course and a requirement below." : "Nothing matches this filter."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Person</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Course</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                    <th scope="col" className="py-2 font-medium">Due or renews</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(({ r, status }) => (
                    <tr key={`${r.profile_id}-${r.course_id}`}>
                      <td className="py-2 pr-3">
                        <Link href={`/admin/people/${r.profile_id}?tab=training`} className="font-medium underline-offset-4 hover:underline">
                          {names.get(r.profile_id) ?? "Unnamed account"}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">{r.course_name}{r.category === "professional" ? " (development)" : ""}</td>
                      <td className="py-2 pr-3"><Badge variant={STATUS_BADGE[status]}>{TRAINING_STATUS_LABEL[status]}</Badge></td>
                      <td className="py-2">{formatDate(trainingDueDate(r))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Who must do which course</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {requirements.value.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">No requirements yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {requirements.value.map((q) => (
                <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{courseName.get(q.course_id) ?? "Unknown course"}</span>, {target(q)}
                  </span>
                  <span className="flex flex-wrap items-start gap-2">
                    <DueDaysForm requirementId={q.id} days={q.due_within_days} />
                    <RemoveRequirementButton requirementId={q.id} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {courses.value.some((c) => c.is_active) && <RequirementForm courses={courses.value} departments={departments.value} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add a course</CardTitle></CardHeader>
        <CardContent><CourseForm /></CardContent>
      </Card>

      {courses.value.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <CardTitle>
              {c.name}
              <span className="ml-2 text-sm font-normal text-charcoal-ink/60">
                {c.category === "mandatory" ? "Mandatory" : "Professional development"}
                {c.renewal_months ? `, renew every ${c.renewal_months} months` : ", no renewal"}
                {c.is_active ? "" : ", no longer used"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent><CourseForm course={c} /></CardContent>
        </Card>
      ))}
    </div>
  );
}
