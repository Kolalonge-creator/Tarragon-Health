"use client";

import Link from "next/link";
import { AlertTriangle, CalendarCheck, Clock, Inbox, MessageSquare, Stethoscope, UserX } from "lucide-react";
import { useCareOperationsSummary, type CareOperationsSummary } from "@/lib/queries/care-operations";
import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * MSG-5: where the care team's work sits today. Counts from public.care_operations_summary (one read, organisation-scoped, no patient
 * detail); every tile links to the queue that holds the work, so this page never becomes a second place to do it.
 *
 * `messagesHref` is the inbox for the viewer's own area (/clinician/messages for a doctor, the coordinator's own tab for a coordinator,
 * which cannot open every /clinician page). Results, alerts and monthly check-ins link to their existing doctor pages.
 */
export function CareOperationsPage({
  messagesHref,
  alertsHref,
  showDoctorLinks,
}: {
  messagesHref: string;
  /** The open-alert queue, when the viewer may open it (doctors, and coordinators: the operations queue is read-only). */
  alertsHref: string | null;
  showDoctorLinks: boolean;
}) {
  const { data, isLoading, isError } = useCareOperationsSummary();

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Could not load the care operations summary. Nothing is shown rather than a zero that might not be true. Try again in a moment.
      </p>
    );
  }
  return <CareOperationsView data={data} messagesHref={messagesHref} alertsHref={alertsHref} showDoctorLinks={showDoctorLinks} />;
}

function TileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
      {children}
    </Link>
  );
}

export function CareOperationsView({
  data,
  messagesHref,
  alertsHref,
  showDoctorLinks,
}: {
  data: CareOperationsSummary;
  messagesHref: string;
  alertsHref: string | null;
  showDoctorLinks: boolean;
}) {
  const m = data.messages;
  const a = data.alerts;
  const mm = data.monthly_meetings;
  const view = (v: string) => `${messagesHref}?view=${v}`;
  // The waiting tiles count unanswered threads only, so they open the inbox filtered the same way.
  const unanswered = (v: string) => `${messagesHref}?view=${v}&unanswered=1`;

  return (
    <div className="space-y-6">
      <section aria-labelledby="ops-messages" className="space-y-3">
        <h2 id="ops-messages" className="font-heading text-lg font-semibold text-charcoal-ink">Patient messages</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TileLink href={view("all")}>
            <StatTile icon={MessageSquare} label="New messages today" value={String(m.new_today)} />
          </TileLink>
          <TileLink href={unanswered("support")}>
            <StatTile icon={Inbox} label="Support, waiting on a reply" value={String(m.support_waiting)} />
          </TileLink>
          <TileLink href={unanswered("clinical")}>
            <StatTile icon={Stethoscope} label="Clinical, waiting on a reply" value={String(m.clinical_waiting)} />
          </TileLink>
          <TileLink href={view("needs_doctor")}>
            <StatTile
              icon={Stethoscope}
              label="Needs a doctor"
              value={String(m.needs_doctor)}
              status={m.needs_doctor > 0 ? { text: "A doctor is needed", tone: "amber" } : undefined}
            />
          </TileLink>
          <TileLink href={unanswered("all")}>
            <StatTile
              icon={Clock}
              label={`Past the ${data.target_hours} hour reply target`}
              value={String(m.past_target)}
              status={m.past_target > 0 ? { text: "Overdue", tone: "red" } : undefined}
            />
          </TileLink>
          <TileLink href={unanswered("all")}>
            <StatTile
              icon={UserX}
              label="Waiting with nobody assigned"
              value={String(m.unowned_waiting)}
              status={m.unowned_waiting > 0 ? { text: "Check routing", tone: "amber" } : undefined}
            />
          </TileLink>
        </div>
        {m.older_unanswered > 0 && (
          <p className="text-sm text-charcoal-ink/70">
            {m.older_unanswered} older {m.older_unanswered === 1 ? "conversation has" : "conversations have"} had no new message for more
            than {data.lookback_days} days and {m.older_unanswered === 1 ? "is" : "are"} not counted as past target. Worth a look.
          </p>
        )}
      </section>

      <section aria-labelledby="ops-safety" className="space-y-3">
        <h2 id="ops-safety" className="font-heading text-lg font-semibold text-charcoal-ink">Clinical safety</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <MaybeLink href={alertsHref}>
            <StatTile
              icon={AlertTriangle}
              label="Open emergency alerts"
              value={String(a.emergency_open)}
              status={a.emergency_open > 0 ? { text: "Act now", tone: "red" } : undefined}
            />
          </MaybeLink>
          <MaybeLink href={alertsHref}>
            <StatTile icon={AlertTriangle} label="Open urgent alerts" value={String(a.urgent_open)} />
          </MaybeLink>
          <MaybeLink href={alertsHref}>
            <StatTile icon={MessageSquare} label="Unread clinical message alerts" value={String(a.unread_message_alerts_open)} />
          </MaybeLink>
        </div>
        {showDoctorLinks && (
          <p className="text-sm text-charcoal-ink/70">
            Results waiting for a doctor are in the <Link className="underline" href="/clinician/results-inbox">results inbox</Link>.
          </p>
        )}
      </section>

      <section aria-labelledby="ops-meetings" className="space-y-3">
        <h2 id="ops-meetings" className="font-heading text-lg font-semibold text-charcoal-ink">Monthly meetings this month</h2>
        <div className="grid grid-cols-3 gap-3">
          <MaybeLink href={showDoctorLinks ? "/clinician/followups" : null}>
            <StatTile icon={CalendarCheck} label="Not booked yet" value={String(mm.available)} />
          </MaybeLink>
          <MaybeLink href={showDoctorLinks ? "/clinician/followups" : null}>
            <StatTile icon={CalendarCheck} label="Booked" value={String(mm.booked)} />
          </MaybeLink>
          <MaybeLink href={showDoctorLinks ? "/clinician/followups" : null}>
            <StatTile icon={CalendarCheck} label="Done" value={String(mm.done)} />
          </MaybeLink>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Who holds what</CardTitle>
          <CardDescription>
            Open conversations each person owns, including anyone who has left but still holds one. Listed by name: this shows where
            work sits, it does not rank anyone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.workload.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No active clinicians or Care Coordinators in this organisation.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-charcoal-ink/60">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Role</th>
                  <th className="py-2 text-right font-medium">Waiting</th>
                  <th className="py-2 text-right font-medium">Past target</th>
                  <th className="py-2 text-right font-medium">Need a doctor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-ink/10">
                {data.workload.map((row) => (
                  <tr key={row.staff_id}>
                    <td className="py-2">
                      {row.name}
                      {!row.active && <span className="ml-1 text-charcoal-ink/50">(no longer active: reassign)</span>}
                    </td>
                    <td className="py-2">
                      {row.is_doctor ? "Doctor" : row.role === "care_coordinator" ? "Care Coordinator" : row.role === "admin" ? "Administrator" : "Clinician"}
                    </td>
                    <td className="py-2 text-right">{row.waiting}</td>
                    <td className="py-2 text-right">
                      {row.past_target > 0 ? <Badge variant="red">{row.past_target}</Badge> : row.past_target}
                    </td>
                    <td className="py-2 text-right">{row.needs_doctor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** A coordinator cannot open the doctor queues, so those tiles are plain for them rather than links that bounce. */
function MaybeLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? <TileLink href={href}>{children}</TileLink> : <>{children}</>;
}
