import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { CancelLeaveButton, DecideLeaveForm, LeaveRequestForm } from "@/components/people/leave-forms";
import { lagosToday } from "@/lib/people/attention";
import { INTERNAL_STAFF_ROLES } from "@/lib/people/directory";
import {
  leaveDates,
  LEAVE_STATUS_BADGE,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  loadLeaveImpact,
  loadLeaveRotaShifts,
  loadLeaveToDecide,
  loadMyLeave,
} from "@/lib/people/leave";

export const metadata = { title: "Leave" };
export const dynamic = "force-dynamic";

const STAFF_ROLES: ReadonlySet<string> = new Set(INTERNAL_STAFF_ROLES);
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
const fmt = (d: string) => DATE.format(new Date(`${d}T12:00:00Z`));

/**
 * Staff leave (HR Phase C, decisions HR-03 and HR-04). Every Tarragon staff member asks for leave here and sees their own
 * requests. A line manager (or an admin, for someone with no manager) also decides the requests waiting for them here; for a
 * clinician the page says how many booked appointments approval will cancel before anyone can approve.
 */
export default async function LeavePage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!STAFF_ROLES.has(profile.role)) redirect("/account");
  const supabase = await createClient();
  const [mine, toDecide] = await Promise.all([loadMyLeave(supabase, profile.id), loadLeaveToDecide(supabase)]);
  const clinicianRequests = toDecide.ok ? toDecide.value.filter((r) => r.is_clinician) : [];
  const [impacts, shifts] = await Promise.all([
    Promise.all(clinicianRequests.map(async (r) => [r.request_id, await loadLeaveImpact(supabase, r.request_id)] as const)).then((e) => new Map(e)),
    Promise.all(clinicianRequests.map(async (r) => [r.request_id, await loadLeaveRotaShifts(supabase, r.request_id)] as const)).then((e) => new Map(e)),
  ]);
  const today = lagosToday();

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" description="Ask for leave and follow its decision. Your line manager decides, or an admin if you have none." backTo={{ href: "/account", label: "Account" }} />

      {!toDecide.ok ? (
        <p className="text-sm text-red-700">{toDecide.message}</p>
      ) : toDecide.value.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Waiting for your decision</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {toDecide.value.map((r) => (
                <li key={r.request_id} className="space-y-2 py-4 text-sm">
                  <p className="font-medium">
                    {r.full_name ?? "Unnamed account"}: {LEAVE_TYPE_LABEL[r.leave_type]}, {leaveDates(r.starts_on, r.ends_on, fmt)} ({r.working_days}{" "}
                    {r.working_days === 1 ? "working day" : "working days"})
                  </p>
                  {r.note && <p className="text-charcoal-ink/70">Their note: {r.note}</p>}
                  <DecideLeaveForm requestId={r.request_id} isClinician={r.is_clinician} cancellations={r.is_clinician ? (impacts.get(r.request_id) ?? null) : 0}
                    rotaShifts={r.is_clinician ? (shifts.get(r.request_id) ?? null) : 0} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Ask for leave</CardTitle></CardHeader>
        <CardContent><LeaveRequestForm today={today} /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Your leave</CardTitle></CardHeader>
        <CardContent>
          {!mine.ok ? (
            <p className="text-sm text-red-700">{mine.message}</p>
          ) : mine.value.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">You have not asked for any leave yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {mine.value.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                  <span className="space-y-1">
                    <span className="block font-medium">
                      {LEAVE_TYPE_LABEL[r.leave_type]}, {leaveDates(r.starts_on, r.ends_on, fmt)} ({r.working_days} {r.working_days === 1 ? "working day" : "working days"})
                    </span>
                    {r.decision_note && <span className="block text-charcoal-ink/70">Note from the decision: {r.decision_note}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={LEAVE_STATUS_BADGE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>
                    {(r.status === "pending" || (r.status === "approved" && r.starts_on > today)) && (
                      <CancelLeaveButton requestId={r.id} label={r.status === "pending" ? "Withdraw" : "Cancel leave"} />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
