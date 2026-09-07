import { redirect } from "next/navigation";
import { getCurrentClinicalStaff, getCurrentProfile } from "@/lib/auth/current-profile";
import { canAssignCases, DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buildCaseloadReport, countBy, type StaffLoadInput } from "@/lib/staffing/caseload";

/**
 * The Chief Medical Officer / Clinical Director's own view of the same
 * caseload report the admin console already builds
 * (admin/staffing/caseload/page.tsx) — reuses buildCaseloadReport/countBy
 * rather than duplicating the report logic. This is a separate access path,
 * not a separate report: every doctor tier logs in as the unified
 * `clinician` account role and reaches /clinician/*, never /admin/* (per
 * CLAUDE.md's "never re-split the account role" rule), so the admin page's
 * `members.activity.view` RBAC gate can never admit a CMO regardless of
 * tier — canAssignCases (chief_medical_officer only) is the gate here
 * instead, mirroring the same authority level as the case-assignment
 * control on the escalation worklist.
 */
export default async function TeamCaseloadPage() {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) {
    redirect("/clinician");
  }

  const profile = await getCurrentProfile();
  if (!profile?.organisation_id) redirect("/clinician");
  const orgId = profile.organisation_id;

  const supabase = await createClient();

  const { data: staffRows } = await supabase
    .from("clinical_staff")
    .select("profile_id, full_name, doctor_tier")
    .eq("organisation_id", orgId)
    .eq("active", true);

  const [{ data: panelRows }, { data: activeEscalationRows }, { data: activeOutreachRows }] =
    await Promise.all([
      supabase
        .from("care_team_assignment")
        .select("clinician_id")
        .eq("organisation_id", orgId)
        .not("clinician_id", "is", null),
      supabase
        .from("escalations")
        .select("assigned_doctor_id")
        .eq("organisation_id", orgId)
        .eq("status", "under_review"),
      supabase
        .from("care_outreach_tasks")
        .select("assigned_to")
        .eq("organisation_id", orgId)
        .in("status", ["in_progress", "contacted"]),
    ]);

  const panelCounts = countBy(panelRows ?? [], (r) => r.clinician_id);
  const activeEscalationCounts = countBy(activeEscalationRows ?? [], (r) => r.assigned_doctor_id);
  const activeOutreachCounts = countBy(activeOutreachRows ?? [], (r) => r.assigned_to);

  const staffInputs: StaffLoadInput[] = (staffRows ?? [])
    .filter((s): s is typeof s & { profile_id: string } => s.profile_id !== null)
    .map((s) => ({
      profileId: s.profile_id,
      fullName: s.full_name,
      doctorTier: s.doctor_tier,
      panelSize: panelCounts.get(s.profile_id) ?? 0,
      activeEscalations: activeEscalationCounts.get(s.profile_id) ?? 0,
      activeOutreach: activeOutreachCounts.get(s.profile_id) ?? 0,
    }));

  const { rows, averageLoadScore } = buildCaseloadReport(staffInputs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Team caseload</h1>
        <p className="text-sm text-charcoal-ink/60">
          Who&apos;s carrying how much, right now, across the whole care team — the same view the
          admin console shows, reachable here without an admin login.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By clinician</CardTitle>
          <CardDescription>
            Panel = standing patients (care team assignment). Active escalations/outreach = work
            this person has personally claimed and hasn&apos;t closed out. Team average today:{" "}
            {averageLoadScore.toFixed(1)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No active clinical staff on file.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                    <th className="py-2 pr-4">Clinician</th>
                    <th className="py-2 pr-4">Tier</th>
                    <th className="py-2 pr-4 text-right">Panel</th>
                    <th className="py-2 pr-4 text-right">Active escalations</th>
                    <th className="py-2 pr-4 text-right">Active outreach</th>
                    <th className="py-2 pr-4 text-right">Load score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-ink/5">
                  {rows.map((row) => (
                    <tr key={row.profileId}>
                      <td className="py-2 pr-4 font-medium text-charcoal-ink">
                        {row.fullName}
                        {row.doctorTier === "chief_medical_officer" && (
                          <Badge variant="blue" className="ml-2">
                            Director
                          </Badge>
                        )}
                        {row.isHighLoad && (
                          <Badge variant="red" className="ml-2">
                            High load
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-charcoal-ink/70">
                        {row.doctorTier ? DOCTOR_TIER_LABEL[row.doctorTier] : "—"}
                      </td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">{row.panelSize}</td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">
                        {row.activeEscalations}
                      </td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">
                        {row.activeOutreach}
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold text-charcoal-ink">
                        {row.loadScore}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
