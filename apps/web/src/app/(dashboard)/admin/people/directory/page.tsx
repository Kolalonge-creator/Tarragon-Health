import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { buildAttention, CREDENTIAL_KINDS, filterDirectory, lagosToday, type DirectoryFilter } from "@/lib/people/attention";
import { loadDepartments, loadDirectory, ROLE_LABEL, STATUS_LABEL, type DirectoryRow } from "@/lib/people/directory";
import { formatDate, PeopleNav } from "../people-nav";

export const metadata = { title: "Staff directory" };
export const dynamic = "force-dynamic";

const SELECT = "min-h-11 rounded-md border px-3 py-2 text-sm";
type Search = { q?: string; department?: string; status?: string; role?: string; clinical?: string; test?: string };

/** Credentialing's own verdicts, never a document-on-file check: unverified is never shown as compliant. */
function credentialSummary(r: DirectoryRow, flagged: Set<string>): { label: string; variant: "normal" | "attention" | "critical" | "inactive" } {
  if (!r.is_clinician) return { label: "Not applicable", variant: "inactive" };
  if (r.verification_satisfied === false) return { label: "Not verified", variant: "critical" };
  if (r.clinician_status === "active" && r.cleared_to_practise === false) return { label: "Not cleared", variant: "critical" };
  return flagged.has(r.profile_id) ? { label: "Needs attention", variant: "attention" } : { label: "Verified", variant: "normal" };
}

/** The staff directory (HR Phase A). Admin only; filters run on the page, test accounts are hidden unless asked for. */
export default async function StaffDirectoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const [directory, departments] = await Promise.all([loadDirectory(supabase), loadDepartments(supabase)]);
  if (!directory.ok) return <p className="text-sm text-red-700">{directory.message}</p>;

  const filter: DirectoryFilter = {
    q: sp.q,
    department: sp.department || undefined,
    status: sp.status || undefined,
    role: sp.role || undefined,
    clinical: sp.clinical === "clinical" || sp.clinical === "non_clinical" ? sp.clinical : undefined,
    includeTest: sp.test === "1",
  };
  const rows = filterDirectory(directory.value, filter);
  const flagged = new Set(
    buildAttention(directory.value, lagosToday())
      .filter((a) => CREDENTIAL_KINDS.has(a.kind))
      .map((a) => a.profileId)
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Staff directory" description="Every Tarragon staff account, with its current employment record." />
      <PeopleNav active="/admin/people/directory" />

      <form method="get" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filter the directory">
        <div className="sm:col-span-3 lg:col-span-2">
          <label htmlFor="q" className="sr-only">Search by name, staff number or job title</label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Name, staff number or job title" />
        </div>
        <div>
          <label htmlFor="department" className="sr-only">Department</label>
          <select id="department" name="department" defaultValue={sp.department ?? ""} className={`${SELECT} w-full`}>
            <option value="">All departments</option>
            {departments.ok && departments.value.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">Employment status</label>
          <select id="status" name="status" defaultValue={sp.status ?? ""} className={`${SELECT} w-full`}>
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            <option value="no_record">No employment record</option>
          </select>
        </div>
        <div>
          <label htmlFor="clinical" className="sr-only">Clinical or non-clinical</label>
          <select id="clinical" name="clinical" defaultValue={sp.clinical ?? ""} className={`${SELECT} w-full`}>
            <option value="">Clinical and non-clinical</option>
            <option value="clinical">Clinical</option>
            <option value="non_clinical">Non-clinical</option>
          </select>
        </div>
        <div>
          <label htmlFor="role" className="sr-only">Account role</label>
          <select id="role" name="role" defaultValue={sp.role ?? ""} className={`${SELECT} w-full`}>
            <option value="">Any role</option>
            {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="test" value="1" defaultChecked={sp.test === "1"} /> Show test accounts
        </label>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="outline">Filter</Button>
          <Link href="/admin/people/directory" className="inline-flex min-h-11 items-center px-3 text-sm underline-offset-4 hover:underline">Clear</Link>
        </div>
      </form>

      <Card>
        <CardContent className="pt-6">
          <p className="mb-3 text-sm text-charcoal-ink/60">{rows.length} {rows.length === 1 ? "person" : "people"}</p>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">Nobody matches these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-medium">Name</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Job title</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Department</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Line manager</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Started</th>
                    <th scope="col" className="py-2 font-medium">Credentials</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => {
                    const cred = credentialSummary(r, flagged);
                    return (
                      <tr key={r.profile_id}>
                        <td className="py-2 pr-3">
                          <Link href={`/admin/people/${r.profile_id}`} className="font-medium underline-offset-4 hover:underline">
                            {r.full_name ?? "Unnamed account"}
                          </Link>
                          <span className="block text-xs text-charcoal-ink/60">
                            {[r.staff_number, ROLE_LABEL[r.role] ?? r.role, r.is_test ? "test account" : null, r.account_active ? null : "sign-in off"]
                              .filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{r.job_title ?? "Not recorded"}</td>
                        <td className="py-2 pr-3">{r.department_name ?? "Not set"}</td>
                        <td className="py-2 pr-3">{r.line_manager_name ?? "None"}</td>
                        <td className="py-2 pr-3">{r.employment_status ? STATUS_LABEL[r.employment_status] : "No record"}</td>
                        <td className="py-2 pr-3">{r.start_date ? formatDate(r.start_date) : "Not recorded"}</td>
                        <td className="py-2"><Badge variant={cred.variant}>{cred.label}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
