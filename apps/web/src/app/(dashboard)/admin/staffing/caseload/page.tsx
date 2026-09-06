import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure } from "@/components/ui/load-failure";
import { anyQueryFailed, failedQueryLabels, joinLabels } from "@/lib/queries/server-query-state";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import {
  buildCaseloadReport,
  buildUtilisationReport,
  countBy,
  type AvailabilityWindow,
  type LeaveWindow,
  type StaffLoadInput,
  type UtilisationInput,
} from "@/lib/staffing/caseload";

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

  const now = new Date();
  const nowIso = now.toISOString();
  const todayIso = nowIso.slice(0, 10);
  const thirtyDaysAgoIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Kept as whole results, not destructured down to `data`/`count`: ten reads
  // fan out here and every figure on the page is derived from some subset of
  // them, so which ones failed is exactly the information the page needs to
  // stay honest. Swallowing them turned a broken read into "Unclaimed
  // escalations: 0", which reads as a fully-staffed team with a clear board.
  const [
    staffRes,
    panelRes,
    activeEscalationRes,
    activeOutreachRes,
    unclaimedEscalationRes,
    unclaimedOutreachRes,
    pendingConsultRes,
    availabilityRuleRes,
    leaveRes,
    appointmentStatusRes,
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
    supabase
      .from("provider_availability_rules")
      .select("clinician_id, start_time, end_time")
      .eq("organisation_id", orgId)
      .eq("is_active", true)
      .or(`effective_until.is.null,effective_until.gte.${todayIso}`),
    supabase
      .from("provider_time_off")
      .select("clinician_id, starts_at, ends_at")
      .eq("organisation_id", orgId)
      .eq("kind", "leave")
      .gte("ends_at", nowIso),
    supabase
      .from("appointments")
      .select("clinician_id, status")
      .eq("organisation_id", orgId)
      .not("clinician_id", "is", null)
      .gte("scheduled_for", thirtyDaysAgoIso)
      .in("status", ["completed", "cancelled", "no_show"]),
  ]);

  const staffRows = staffRes.data;
  const panelRows = panelRes.data;
  const activeEscalationRows = activeEscalationRes.data;
  const activeOutreachRows = activeOutreachRes.data;
  const availabilityRuleRows = availabilityRuleRes.data;
  const leaveRows = leaveRes.data;
  const appointmentStatusRows = appointmentStatusRes.data;

  // Three separate honesty boundaries, because they fail independently and a
  // reader can safely trust the ones that did load. The unclaimed-work strip
  // is the one that must never render a false zero: it is the "does anyone
  // need to pick something up right now" glance.
  const unclaimedLabels = failedQueryLabels([
    { label: "unclaimed escalations", error: unclaimedEscalationRes.error },
    { label: "unclaimed outreach tasks", error: unclaimedOutreachRes.error },
    { label: "pending questions", error: pendingConsultRes.error },
  ]);
  const caseloadFailed = anyQueryFailed([staffRes, panelRes, activeEscalationRes, activeOutreachRes]);
  const utilisationFailed = anyQueryFailed([
    staffRes,
    availabilityRuleRes,
    leaveRes,
    appointmentStatusRes,
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

  const availabilityByClinicianId = new Map<string, AvailabilityWindow[]>();
  for (const r of availabilityRuleRows ?? []) {
    const windows = availabilityByClinicianId.get(r.clinician_id) ?? [];
    windows.push({ startTime: r.start_time, endTime: r.end_time });
    availabilityByClinicianId.set(r.clinician_id, windows);
  }

  const leaveByClinicianId = new Map<string, LeaveWindow[]>();
  for (const r of leaveRows ?? []) {
    const windows = leaveByClinicianId.get(r.clinician_id) ?? [];
    windows.push({ startsAt: r.starts_at, endsAt: r.ends_at });
    leaveByClinicianId.set(r.clinician_id, windows);
  }

  const completedCounts = countBy(appointmentStatusRows ?? [], (r) =>
    r.status === "completed" ? r.clinician_id : null
  );
  const cancelledCounts = countBy(appointmentStatusRows ?? [], (r) =>
    r.status === "cancelled" ? r.clinician_id : null
  );
  const noShowCounts = countBy(appointmentStatusRows ?? [], (r) =>
    r.status === "no_show" ? r.clinician_id : null
  );

  const utilisationInputs: UtilisationInput[] = (staffRows ?? [])
    .filter((s): s is typeof s & { profile_id: string } => s.profile_id !== null)
    .map((s) => ({
      clinicianId: s.profile_id,
      fullName: s.full_name,
      availabilityWindows: availabilityByClinicianId.get(s.profile_id) ?? [],
      leaveWindows: leaveByClinicianId.get(s.profile_id) ?? [],
      completedConsultations: completedCounts.get(s.profile_id) ?? 0,
      cancelledConsultations: cancelledCounts.get(s.profile_id) ?? 0,
      noShowConsultations: noShowCounts.get(s.profile_id) ?? 0,
    }));

  const utilisationRows = buildUtilisationReport(utilisationInputs);

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Doctor caseload"
        description="Who's carrying how much, right now. There's no fixed target ratio to compare against; this ranks the team against its own average load today."
      />

      {/* Instead of the tiles, never above them: a row of zeroes beside an
          error message is still a row of zeroes, and this strip's whole job
          is to answer "is there unclaimed work right now". */}
      {unclaimedLabels.length > 0 ? (
        <LoadFailure>
          The count of {joinLabels(unclaimedLabels)} could not be loaded, so this page cannot say
          whether anything is sitting unclaimed. Do not read it as a clear board. The escalation
          and outreach queues themselves still open from the sidebar; reload this page to try
          again.
        </LoadFailure>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatTile
            icon={SEMANTIC_ICON.escalation}
            tintClassName="bg-amber-50"
            iconClassName="text-amber-600"
            label="Unclaimed escalations"
            value={String(unclaimedEscalationRes.count ?? 0)}
          />
          <StatTile
            icon={SEMANTIC_ICON.clinicianFollowUp}
            tintClassName="bg-blue-50"
            iconClassName="text-blue-600"
            label="Unclaimed outreach tasks"
            value={String(unclaimedOutreachRes.count ?? 0)}
          />
          <StatTile
            icon={NAV_ICON.messages}
            tintClassName="bg-charcoal-ink/5"
            iconClassName="text-charcoal-ink/60"
            label={'Pending "Ask a doctor" questions'}
            value={String(pendingConsultRes.count ?? 0)}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>By clinician</CardTitle>
          <CardDescription>
            Panel = standing patients (care team assignment). Active escalations/outreach = work
            this person has personally claimed and hasn&apos;t closed out. Load score weights a
            claimed escalation heaviest, then outreach, then plain panel size. It&apos;s a rough
            sort order, not a validated formula, which is why the raw counts are shown alongside
            it.{caseloadFailed ? "" : ` Team average today: ${averageLoadScore.toFixed(1)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* "No active clinical staff in this organisation" from a failed
              staff read is a claim nobody works here, and an understated
              panel/escalation count from a failed join is worse than none:
              it makes an overloaded doctor look comfortable. */}
          {caseloadFailed ? (
            <LoadFailure>
              This caseload table could not be loaded. It is not a report that nobody is carrying
              work, and the load scores it would have shown cannot be trusted. Reload the page to
              try again.
            </LoadFailure>
          ) : rows.length === 0 ? (
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

      <Card>
        <CardHeader>
          <CardTitle>Utilisation</CardTitle>
          <CardDescription>
            Availability = active recurring rules (Admin &gt; Availability). Completed/cancelled/
            no-show are trailing 30 days from appointments. Utilisation % is completed consultations
            as a share of all attempted ones (completed + cancelled + no-show), a visibility figure,
            not a target ratio or a flag.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {utilisationFailed ? (
            <LoadFailure>
              This utilisation table could not be loaded. Availability, leave and the trailing
              30 days of appointments are all missing rather than zero, so no percentage here can
              be read as low or high. Reload the page to try again.
            </LoadFailure>
          ) : utilisationRows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No active clinical staff in this organisation.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
                    <th className="py-2 pr-4">Clinician</th>
                    <th className="py-2 pr-4 text-right">Available hrs/wk</th>
                    <th className="py-2 pr-4">On leave</th>
                    <th className="py-2 pr-4 text-right">Completed (30d)</th>
                    <th className="py-2 pr-4 text-right">Cancelled</th>
                    <th className="py-2 pr-4 text-right">No-show</th>
                    <th className="py-2 pr-4 text-right">Utilisation %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-charcoal-ink/5">
                  {utilisationRows.map((row) => (
                    <tr key={row.clinicianId}>
                      <td className="py-2 pr-4 font-medium text-charcoal-ink">{row.fullName}</td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">
                        {row.availableHoursPerWeek.toFixed(1)}
                      </td>
                      <td className="py-2 pr-4">
                        {row.onLeave && row.currentOrNextLeave ? (
                          <Badge variant="amber">Until {formatDate(row.currentOrNextLeave.endsAt)}</Badge>
                        ) : row.currentOrNextLeave ? (
                          <span className="text-charcoal-ink/50">
                            From {formatDate(row.currentOrNextLeave.startsAt)}
                          </span>
                        ) : (
                          <span className="text-charcoal-ink/40">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">
                        {row.completedConsultations}
                      </td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">
                        {row.cancelledConsultations}
                      </td>
                      <td className="py-2 pr-4 text-right text-charcoal-ink/80">
                        {row.noShowConsultations}
                      </td>
                      <td className="py-2 pr-4 text-right font-semibold text-charcoal-ink">
                        {(row.utilisationPct * 100).toFixed(0)}%
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
