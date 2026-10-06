import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import {
  KIND_LABEL,
  adminSummaryRowsSchema,
  healthSchema,
  reviewRowsSchema,
  reviewWords,
  scheduleRowsSchema,
  type FeeItems,
} from "@/lib/earnings/earnings";
import { AdjustmentForm, ApproveForm, DiscardForm, FeeScheduleForm } from "./earnings-forms";

const date = (value: string): string => new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Africa/Lagos" });

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-red-600">
      {children}
    </p>
  );
}

/**
 * The admin earnings page (S30): the fee schedule (draft, approve), what needs a person, who has earned what, and adjustments.
 * Admin accounts only; the database checks the role again on every call. Test accounts are left out (INV-13).
 * A failed load says so and is never shown as an empty list.
 */
export async function AdminEarningsView() {
  const supabase = await createClient();
  const [health, schedules, review, summary, types, staff] = await Promise.all([
    supabase.rpc("earnings_health"),
    supabase.rpc("list_fee_schedules"),
    supabase.rpc("earnings_needing_review"),
    supabase.rpc("earnings_admin_summary"),
    supabase.from("task_types").select("code").eq("is_active", true).order("code"),
    supabase.from("clinical_staff").select("profile_id, full_name").eq("employment_type", "contracted").eq("active", true).order("full_name"),
  ]);

  const h = health.error ? null : healthSchema.safeParse(health.data);
  const sch = schedules.error ? null : scheduleRowsSchema.safeParse(schedules.data);
  const rev = review.error ? null : reviewRowsSchema.safeParse(review.data);
  const sum = summary.error ? null : adminSummaryRowsSchema.safeParse(summary.data);
  const taskTypes = types.error ? null : types.data.map((t) => t.code);
  const clinicians = staff.error
    ? null
    : staff.data.filter((s): s is { profile_id: string; full_name: string } => s.profile_id !== null).map((s) => ({ id: s.profile_id, name: s.full_name }));

  const approved = sch?.success ? sch.data.find((s) => s.status === "approved") : undefined;
  const draft = sch?.success ? sch.data.find((s) => s.status === "draft") : undefined;
  const start: FeeItems | null = draft?.items ?? approved?.items ?? null;
  const requestId = randomUUID();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Fees and earnings</h1>
        <p className="text-sm text-charcoal-ink/60">
          Set what contracted clinicians earn per piece of work, approve it, and see what is owed. Employed doctors are paid by salary and never appear here.
          Money is paid out in a later step; nothing on this page moves money.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Where things stand</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {health.error || !h?.success ? (
            <Problem>The status could not be loaded. This is not the same as everything being fine.</Problem>
          ) : (
            <>
              <p>{h.data.approved_version === null ? "No fee schedule is approved yet. Finished work waits for one and is paid at the first schedule you approve." : `Fee schedule version ${h.data.approved_version} is in force.`}</p>
              {h.data.tasks_waiting_for_a_schedule > 0 && <p>{h.data.tasks_waiting_for_a_schedule} finished task(s) are waiting for a schedule{h.data.oldest_waiting_at ? `, the oldest since ${date(h.data.oldest_waiting_at)}` : ""}.</p>}
              {h.data.lines_needing_review > 0 && <p>{h.data.lines_needing_review} line(s) need you to correct them (below).</p>}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Fee schedule
            {draft ? <Badge variant="amber">Draft version {draft.version}</Badge> : approved ? <Badge variant="green">Version {approved.version} in force</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {taskTypes === null || schedules.error || !sch?.success ? (
            <Problem>The fee schedules could not be loaded. Please refresh the page.</Problem>
          ) : (
            <>
              <p className="text-sm text-charcoal-ink/70">
                {draft ? "Edit the draft, then approve it. " : approved ? "Version " + approved.version + " cannot be changed. Save the form as a new draft to change an amount. " : "Fill this in to create the first draft. "}
                A task type left without a fee is flagged for you to correct when it is first finished.
              </p>
              <FeeScheduleForm taskTypes={taskTypes} start={start} draftId={draft?.id ?? null} note={draft?.note ?? null} />
              {draft && (
                <div className="flex flex-wrap gap-6 border-t border-charcoal-ink/10 pt-4">
                  <ApproveForm scheduleId={draft.id} version={draft.version} />
                  <DiscardForm scheduleId={draft.id} />
                </div>
              )}
              {sch.data.length > 0 && (
                <p className="text-xs text-charcoal-ink/60">
                  History: {sch.data.map((s) => `version ${s.version} ${s.status}${s.approved_at ? ` (${date(s.approved_at)})` : ""}`).join("; ")}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Lines that need you</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {review.error || !rev?.success || clinicians === null ? (
            <Problem>The list could not be loaded. This is not the same as having none.</Problem>
          ) : rev.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing needs correcting.</p>
          ) : (
            rev.data.map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
                <p className="text-sm">
                  <span className="font-medium">{clinicians.find((c) => c.id === r.clinician_id)?.name ?? "A clinician"}</span>, {KIND_LABEL[r.kind] ?? r.kind}
                  {r.task_type ? ` (${r.task_type})` : ""}, {date(r.earned_at)}. {reviewWords(r.needs_review)}
                </p>
                <AdjustmentForm clinicians={clinicians} corrects={r.id} defaultClinician={r.clinician_id} requestId={randomUUID()} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Who has earned what</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {summary.error || !sum?.success ? (
            <Problem>The summary could not be loaded. This is not the same as nobody having earned anything.</Problem>
          ) : sum.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No earnings yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-charcoal-ink/60"><th className="py-1 pr-3 font-medium">Clinician</th><th className="py-1 pr-3 font-medium">Lines</th><th className="py-1 pr-3 font-medium">Total</th><th className="py-1 pr-3 font-medium">Not yet paid out</th><th className="py-1 font-medium">Need a correction</th></tr>
                </thead>
                <tbody>
                  {sum.data.map((r) => (
                    <tr key={r.clinician_id}>
                      <td className="py-1 pr-3">{r.full_name ?? "Unnamed"}</td>
                      <td className="py-1 pr-3">{r.lines}</td>
                      <td className="py-1 pr-3">{formatKobo(r.total_kobo)}</td>
                      <td className="py-1 pr-3">{formatKobo(r.unpaid_kobo)}</td>
                      <td className="py-1">{r.needs_review}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-charcoal-ink/60">Test accounts are not counted.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Adjustments</CardTitle></CardHeader>
        <CardContent>
          {clinicians === null ? (
            <Problem>The list of contracted clinicians could not be loaded.</Problem>
          ) : clinicians.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">There are no contracted clinicians yet.</p>
          ) : (
            <AdjustmentForm clinicians={clinicians} requestId={requestId} />
          )}
          <p className="mt-2 text-xs text-charcoal-ink/60">An adjustment is the only way to fix a line. The ledger itself is never edited. The clinician is told and sees your reason.</p>
        </CardContent>
      </Card>
    </div>
  );
}
