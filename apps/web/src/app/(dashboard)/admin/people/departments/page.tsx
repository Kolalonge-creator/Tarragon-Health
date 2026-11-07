import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { isCurrentStaff } from "@/lib/people/attention";
import { loadDepartments, loadDirectory } from "@/lib/people/directory";
import { DepartmentForm } from "../people-forms";
import { PeopleNav } from "../people-nav";

export const metadata = { title: "Departments" };
export const dynamic = "force-dynamic";

/**
 * Tarragon's own departments (HR Phase A). Admin only. A department with current staff cannot be retired until they are
 * moved (enforced in save_staff_department). Not the employer or partner department lists, which belong to customers.
 */
export default async function DepartmentsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = await createClient();
  const [departments, directory] = await Promise.all([loadDepartments(supabase), loadDirectory(supabase)]);
  if (!departments.ok) return <p className="text-sm text-red-700">{departments.message}</p>;
  if (!directory.ok) return <p className="text-sm text-red-700">{directory.message}</p>;

  const current = directory.value.filter((r) => !r.is_test && isCurrentStaff(r));
  const staff = current.map((r) => ({ id: r.profile_id, name: r.full_name ?? "Unnamed account" }));
  const headcount = (id: string) => current.filter((r) => r.department_id === id).length;

  return (
    <div className="space-y-6">
      <PageHeader title="Departments" description="Tarragon's own departments and who heads each one. People are placed in a department from their employment record." />
      <PeopleNav active="/admin/people/departments" />

      <Card>
        <CardHeader><CardTitle>Add a department</CardTitle></CardHeader>
        <CardContent><DepartmentForm staff={staff} /></CardContent>
      </Card>

      {departments.value.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">No departments yet.</p>
      ) : (
        departments.value.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle>
                {d.name}
                <span className="ml-2 text-sm font-normal text-charcoal-ink/60">
                  {headcount(d.id)} {headcount(d.id) === 1 ? "person" : "people"}{d.is_active ? "" : " · no longer used"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent><DepartmentForm department={d} staff={staff} /></CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
