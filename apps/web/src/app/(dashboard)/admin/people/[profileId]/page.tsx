import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { buildAttention, isCurrentStaff, lagosToday } from "@/lib/people/attention";
import {
  CHANGE_KIND_LABEL,
  loadDepartments,
  loadDirectory,
  loadEmploymentHistory,
  loadPersonalDetails,
  maskNationalId,
  PATTERN_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  type CurrentPosition,
} from "@/lib/people/directory";
import { EmploymentChangeForm, PersonalDetailsForm } from "../people-forms";
import { formatDate } from "../people-nav";

export const metadata = { title: "Staff profile" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "employment", label: "Employment" },
  { key: "personal", label: "Personal details" },
  { key: "credentials", label: "Credentials" },
  { key: "access", label: "Platform access" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-charcoal-ink/60">{label}</dt>
      <dd className="col-span-2">{value}</dd>
    </div>
  );
}

/**
 * One staff member's HR profile (HR Phase A). Admin only. Employment is HR's own record (append-only history); personal
 * details are read through an audited database function and only when that tab is opened; credentials and platform access
 * are shown read-only with a link to the page that owns them, so there is never a second copy to drift.
 */
export default async function StaffProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ tab?: string; edit?: string }>;
}) {
  const me = await getCurrentProfile();
  if (me?.role !== "admin") redirect("/admin");
  const { profileId } = await params;
  if (!z.string().uuid().safeParse(profileId).success) notFound();
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === sp.tab)?.key ?? "employment";

  const supabase = await createClient();
  const [directory, history, departments] = await Promise.all([
    loadDirectory(supabase),
    loadEmploymentHistory(supabase, profileId),
    loadDepartments(supabase),
  ]);
  if (!directory.ok) return <p className="text-sm text-red-700">{directory.message}</p>;
  const person = directory.value.find((r) => r.profile_id === profileId);
  if (!person) notFound();

  const today = lagosToday();
  const attention = buildAttention([person, ...directory.value.filter((r) => r.line_manager_id === profileId)], today).filter(
    (a) => a.profileId === profileId
  );
  const managers = directory.value
    .filter((r) => !r.is_test && isCurrentStaff(r) && r.account_active)
    .map((r) => ({ id: r.profile_id, name: r.full_name ?? "Unnamed account" }));
  const deptName = (id: string | null) => (departments.ok ? departments.value.find((d) => d.id === id)?.name : undefined) ?? "Not set";
  const nameOf = (id: string | null) => directory.value.find((r) => r.profile_id === id)?.full_name ?? (id ? "Unknown" : "None");
  // The record in force comes from the database's own rule (people_directory), never re-derived here.
  const current: CurrentPosition | null = person.has_employment_record ? person : null;
  const historyRows = history.ok
    ? [...history.value].sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.recorded_at.localeCompare(a.recorded_at))
    : [];
  const personal = tab === "personal" ? await loadPersonalDetails(supabase, profileId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={person.full_name ?? "Unnamed account"}
        description={[person.job_title, person.department_name, person.staff_number, ROLE_LABEL[person.role] ?? person.role].filter(Boolean).join(" · ")}
        backTo={{ href: "/admin/people/directory", label: "Staff directory" }}
      />
      {person.is_test && <p className="text-sm text-charcoal-ink/70">This is a test account.</p>}

      {attention.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Needs attention</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {attention.map((a) => (
                <li key={a.kind} className="flex flex-wrap items-center gap-2">
                  <Badge variant={a.priority === "high" ? "critical" : a.priority === "medium" ? "attention" : "info"}>{a.issue}</Badge>
                  <Link href={a.href} className="text-brand-green underline-offset-4 hover:underline">{a.nextAction}</Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <nav aria-label="Profile sections" className="flex flex-wrap gap-2 border-b pb-2 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/people/${profileId}${t.key === "employment" ? "" : `?tab=${t.key}`}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`rounded-md px-3 py-2 ${t.key === tab ? "bg-brand-green/10 font-medium text-brand-green" : "hover:bg-charcoal-ink/5"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "employment" && (
        <>
          <Card>
            <CardHeader><CardTitle>Current position</CardTitle></CardHeader>
            <CardContent>
              {!person.has_employment_record ? (
                <p className="text-sm text-charcoal-ink/70">No employment record yet. Record their appointment below.</p>
              ) : (
                <dl className="divide-y">
                  <Row label="Job title" value={person.job_title} />
                  <Row label="Department" value={person.department_name ?? "Not set"} />
                  <Row label="Line manager" value={person.line_manager_name ?? "None"} />
                  <Row label="Status" value={person.employment_status ? STATUS_LABEL[person.employment_status] : "Not recorded"} />
                  <Row label="Employed or contracted" value={person.engagement === "contracted" ? "Contracted" : person.engagement === "employed" ? "Employed" : "Not recorded"} />
                  <Row label="Working pattern" value={person.work_pattern ? PATTERN_LABEL[person.work_pattern] : "Not recorded"} />
                  <Row label="Contracted hours" value={person.contracted_hours_per_week !== null ? `${person.contracted_hours_per_week} a week` : "Not recorded"} />
                  <Row label="Started" value={formatDate(person.start_date)} />
                  <Row label="Contract ends" value={person.contract_end_date ? formatDate(person.contract_end_date) : "Permanent"} />
                  <Row label="Work location" value={person.work_location ?? "Not recorded"} />
                </dl>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{!current || current.employment_status === "left" ? "Record an appointment" : "Record a change"}</CardTitle></CardHeader>
            <CardContent>
              <EmploymentChangeForm
                profileId={profileId}
                current={current}
                isClinician={person.is_clinician}
                departments={departments.ok ? departments.value : []}
                managers={managers}
                today={today}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Employment history</CardTitle></CardHeader>
            <CardContent>
              {!history.ok ? (
                <p className="text-sm text-red-700">{history.message}</p>
              ) : historyRows.length === 0 ? (
                <p className="text-sm text-charcoal-ink/70">Nothing recorded yet.</p>
              ) : (
                <ol className="divide-y text-sm">
                  {historyRows.map((h) => (
                    <li key={h.id} className="space-y-1 py-3">
                      <p className="font-medium">
                        {CHANGE_KIND_LABEL[h.change_kind]}, from {formatDate(h.effective_from)}
                        {h.effective_from > today && <span className="ml-2 text-charcoal-ink/60">(not yet in force)</span>}
                      </p>
                      <p className="text-charcoal-ink/70">
                        {h.job_title} · {deptName(h.department_id)} · reports to {nameOf(h.line_manager_id)} · {STATUS_LABEL[h.employment_status]}
                      </p>
                      {h.note && <p className="text-charcoal-ink/70">{h.note}</p>}
                      <p className="text-xs text-charcoal-ink/50">Recorded {formatDate(h.recorded_at)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {tab === "personal" && personal && (
        <Card>
          <CardHeader><CardTitle>Personal details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-charcoal-ink/70">
              Only admins and the person themself can see these. Opening this tab is recorded in the audit log.
            </p>
            {!personal.ok ? (
              <p className="text-sm text-red-700">{personal.message}</p>
            ) : sp.edit === "1" ? (
              <PersonalDetailsForm profileId={profileId} details={personal.value} />
            ) : (
              <>
                <dl className="divide-y">
                  <Row label="Emergency contact" value={personal.value?.emergency_contact_name
                    ? `${personal.value.emergency_contact_name}${personal.value.emergency_contact_relationship ? ` (${personal.value.emergency_contact_relationship})` : ""}, ${personal.value.emergency_contact_phone ?? "no phone"}`
                    : "Not recorded"} />
                  <Row label="Home address" value={personal.value?.home_address ?? "Not recorded"} />
                  <Row label="National ID number" value={maskNationalId(personal.value?.national_id_number ?? null)} />
                  {personal.value && <Row label="Last updated" value={formatDate(personal.value.updated_at)} />}
                </dl>
                <Link href={`/admin/people/${profileId}?tab=personal&edit=1`} className="text-sm text-brand-green underline-offset-4 hover:underline">
                  Edit personal details
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "credentials" && (
        <Card>
          <CardHeader><CardTitle>Professional registration</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!person.is_clinician ? (
              <p className="text-sm text-charcoal-ink/70">No professional registration is required for this role.</p>
            ) : (
              <>
                <dl className="divide-y">
                  <Row label="Registration verified at source" value={person.verification_satisfied ? "Yes" : "No"} />
                  <Row label="Cleared for clinical work" value={person.cleared_to_practise ? "Yes" : "No"} />
                  <Row label="Practising licence expires" value={formatDate(person.licence_expires_at)} />
                  <Row label="Indemnity" value={person.indemnity_exempt ? "Exempt" : !person.indemnity_required ? "Covered by Tarragon's policy" : person.indemnity_expires_at ? `Expires ${formatDate(person.indemnity_expires_at)}` : "Not recorded"} />
                  <Row label="Employed or contracted" value={person.clinician_employment_type ?? "Not recorded"} />
                  <Row label="Clinical tier" value={person.doctor_tier?.replaceAll("_", " ") ?? "Not assigned"} />
                </dl>
                <p className="text-sm text-charcoal-ink/70">
                  Shown from the clinician record. Verification, renewals and clinical readiness are managed in{" "}
                  <Link href="/admin/credentialing" className="text-brand-green underline-offset-4 hover:underline">clinician credentialing</Link>; a document on file is not the same as being cleared to practise.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "access" && (
        <Card>
          <CardHeader><CardTitle>Platform access</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <dl className="divide-y">
              <Row label="Account role" value={ROLE_LABEL[person.role] ?? person.role} />
              <Row label="Can sign in" value={person.account_active ? "Yes" : "No"} />
            </dl>
            <p className="text-sm text-charcoal-ink/70">
              HR records never change access. Change a role or switch off sign-in on the{" "}
              <Link href={`/admin/members/${profileId}`} className="text-brand-green underline-offset-4 hover:underline">member page</Link>.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
