import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { buildCaseloadReport, countBy, type StaffLoadInput } from "@/lib/staffing/caseload";

/**
 * Ops-facing view of who's carrying how much, right now — not a fixed
 * doctor:patient ratio (there isn't one, see CLAUDE.md's Non-Negotiable
 * Business Rules: "no set number, just be efficient"). Load is standing
 * panel size (care_team_assignment) plus currently claimed active work
 * (escalations under review, outreach tasks in progress/contacted),
 * weighted so an acute claimed escalation counts for more than one more
 * name on a panel — see lib/staffing/caseload.ts for the exact weights.
 * "High load" is flagged relative to the team's own average today, not
 * against any external target.
 */
export default async function DoctorCaseloadPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.organisation_id) redirect("/admin");

  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!isSuperAdmin && !keys.has("members.activity.view")) redirect("/admin");

  const orgId = profile.organisation_id;
  const supabase = await createClient();

  const [
    { data: staffRows },
    { data: panelRows },
    { data: activeEscalationRows },
    { data: activeOutreachRows },
    { count: unclaimedEscalations },
    { count: unclaimedOutreach },
    { count: pendingConsults },
  ] = await Promise.all([
    supabase
      .from("clinical_staff")
      .select("profile_id, full_name, doctor_tier, is_clinical_director")
      .eq("organisation_id", orgId)
      .eq("active", true),
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
    supabase
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("status", "open"),
    supabase
      .from("care_outreach_tasks")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .eq("status", "open"),
    supabase
      .from("async_consults")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", orgId)
      .in("status", ["submitted", "in_review"]),
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
      isClinicalDirector: s.is_clinical_director,
      panelSize: panelCounts.get(s.profile_id) ?? 0,
      activeEscalations: activeEscalationCounts.get(s.profile_id) ?? 0,
      activeOutreach: activeOutreachCounts.get(s.profile_id) ?? 0,
    }));

  const { rows, averageLoadScore } = buildCaseloadReport(staffInputs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Doctor caseload</h1>
        <p className="text-charcoal-ink/60">
          Who&apos;s carrying how much, right now. There&apos;s no fixed target ratio to compare
          against; this ranks the team against its own average load today.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName="bg-amber-50"
          iconClassName="text-amber-600"
          label="Unclaimed escalations"
          value={String(unclaimedEscalations ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.clinicianFollowUp}
          tintClassName="bg-blue-50"
          iconClassName="text-blue-600"
          label="Unclaimed outreach tasks"
          value={String(unclaimedOutreach ?? 0)}
        />
        <StatTile
          icon={NAV_ICON.messages}
          tintClassName="bg-charcoal-ink/5"
          iconClassName="text-charcoal-ink/60"
          label={'Pending "Ask a doctor" questions'}
          value={String(pendingConsults ?? 0)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By clinician</CardTitle>
          <CardDescription>
            Panel = standing patients (care team assignment). Active escalations/outreach = work
            this person has personally claimed and hasn&apos;t closed out. Load score weights a
            claimed escalation heaviest, then outreach, then plain panel size. It&apos;s a rough
            sort order, not a validated formula, which is why the raw counts are shown alongside
            it. Team average today: {averageLoadScore.toFixed(1)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No active clinical staff in this organisation.</p>
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
                        {row.isClinicalDirector && (
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
