import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { CancelLeaveButton, DecideLeaveForm } from "@/components/people/leave-forms";
import { lagosToday } from "@/lib/people/attention";
import {
  leaveDates,
  LEAVE_STATUS_BADGE,
  LEAVE_STATUS_LABEL,
  LEAVE_STATUSES,
  LEAVE_TYPE_LABEL,
  loadAllLeave,
  loadLeaveImpact,
  loadLeaveRotaShifts,
} from "@/lib/people/leave";
import { formatDate, PeopleNav } from "../people-nav";

export const metadata = { title: "Leave" };
export const dynamic = "force-dynamic";

interface Rpc {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Leave for the whole organisation (HR Phase C). Admin only. Requests waiting for a decision (an admin may decide any, never
 * their own), who is away in the next eight weeks, and every request. The sickness reason is shown only when an admin asks
 * for it on one request, and that read is recorded in the audit log.
 */
export default async function AdminLeavePage({ searchParams }: { searchParams: Promise<{ status?: string; reason?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const supabase = await createClient();
  const today = lagosToday();
  const all = await loadAllLeave(supabase);
  if (!all.ok) return <p className="text-sm text-red-700">{all.message}</p>;

  const pending = all.value.filter((r) => r.status === "pending");
  const decidable = pending.filter((r) => r.is_clinician && r.profile_id !== profile.id);
  const [impacts, shifts] = await Promise.all([
    Promise.all(decidable.map(async (r) => [r.request_id, await loadLeaveImpact(supabase, r.request_id)] as const)).then((e) => new Map(e)),
    Promise.all(decidable.map(async (r) => [r.request_id, await loadLeaveRotaShifts(supabase, r.request_id)] as const)).then((e) => new Map(e)),
  ]);
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 56 * 86400000).toISOString().slice(0, 10);
  const away = all.value
    .filter((r) => r.status === "approved" && r.ends_on >= today && r.starts_on <= horizon)
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const status = LEAVE_STATUSES.find((s) => s === sp.status);
  const listed = status ? all.value.filter((r) => r.status === status) : all.value;

  let reasonShown: { id: string; text: string | null; error?: string } | null = null;
  if (sp.reason && z.string().uuid().safeParse(sp.reason).success) {
    const { data, error } = await (supabase as unknown as Rpc).rpc("leave_sickness_reason", { p_request: sp.reason });
    reasonShown = error ? { id: sp.reason, text: null, error: "The reason could not be loaded." } : { id: sp.reason, text: typeof data === "string" ? data : null };
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" description="Who is asking for leave, who is away, and every request. Staff ask for leave from their account page." />
      <PeopleNav active="/admin/people/leave" />

      <Card>
        <CardHeader><CardTitle>Waiting for a decision ({pending.length})</CardTitle></CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">Nothing is waiting.</p>
          ) : (
            <ul className="divide-y">
              {pending.map((r) => (
                <li key={r.request_id} className="space-y-2 py-4 text-sm">
                  <p className="font-medium">
                    <Link href={`/admin/people/${r.profile_id}`} className="underline-offset-4 hover:underline">{r.full_name ?? "Unnamed account"}</Link>:{" "}
                    {LEAVE_TYPE_LABEL[r.leave_type]}, {leaveDates(r.starts_on, r.ends_on, formatDate)} ({r.working_days} working days), asked {formatDate(r.requested_at)}
                  </p>
                  {r.profile_id === profile.id ? (
                    <p className="text-charcoal-ink/70">This is your own request, so another admin or your line manager decides it.</p>
                  ) : (
                    <DecideLeaveForm requestId={r.request_id} isClinician={r.is_clinician} cancellations={r.is_clinician ? (impacts.get(r.request_id) ?? null) : 0}
                      rotaShifts={r.is_clinician ? (shifts.get(r.request_id) ?? null) : 0} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Away in the next eight weeks</CardTitle></CardHeader>
        <CardContent>
          {away.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">Nobody has approved leave in the next eight weeks.</p>
          ) : (
            <ul className="divide-y text-sm">
              {away.map((r) => (
                <li key={r.request_id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{r.full_name ?? "Unnamed account"}{r.is_clinician ? " (clinician)" : ""}</span>
                  <span className="text-charcoal-ink/70">{leaveDates(r.starts_on, r.ends_on, formatDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-sm">
            <Link href="/admin/people/leave" aria-current={!status ? "page" : undefined} className={`rounded-md px-3 py-1.5 ${!status ? "bg-brand-green/10 font-medium text-brand-green" : "hover:bg-charcoal-ink/5"}`}>All</Link>
            {LEAVE_STATUSES.map((s) => (
              <Link key={s} href={`/admin/people/leave?status=${s}`} aria-current={status === s ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 ${status === s ? "bg-brand-green/10 font-medium text-brand-green" : "hover:bg-charcoal-ink/5"}`}>
                {LEAVE_STATUS_LABEL[s]}
              </Link>
            ))}
          </nav>
          {listed.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">No requests.</p>
          ) : (
            <ul className="divide-y text-sm">
              {listed.map((r) => (
                <li key={r.request_id} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{r.full_name ?? "Unnamed account"}</span>: {LEAVE_TYPE_LABEL[r.leave_type]}, {leaveDates(r.starts_on, r.ends_on, formatDate)}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={LEAVE_STATUS_BADGE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>
                      {(r.status === "pending" || r.status === "approved") && <CancelLeaveButton requestId={r.request_id} />}
                    </span>
                  </div>
                  {r.decided_by_name && <p className="text-charcoal-ink/60">Decided by {r.decided_by_name}{r.decided_at ? ` on ${formatDate(r.decided_at)}` : ""}</p>}
                  {r.has_sickness_reason && (
                    reasonShown?.id === r.request_id ? (
                      <p className="text-charcoal-ink/80">{reasonShown.error ?? `Reason: ${reasonShown.text ?? "none recorded"}`}</p>
                    ) : (
                      <Link href={`/admin/people/leave?${status ? `status=${status}&` : ""}reason=${r.request_id}`} className="text-brand-green underline-offset-4 hover:underline">
                        Show the sickness reason (recorded in the audit log)
                      </Link>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
