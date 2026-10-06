import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatKobo } from "@/lib/format-money";
import { KIND_LABEL, explainLine, ledgerRowsSchema, myScheduleSchema, summarySchema } from "@/lib/earnings/earnings";

const dateTime = (value: string): string => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });

/**
 * A contracted clinician's statement: totals, the fee schedule that applies to them, and every ledger line with how it was worked out.
 * Employed doctors are paid by salary and are told so. A line names a task type and a date, never a patient.
 */
export async function ClinicianEarningsView() {
  const supabase = await createClient();
  const summaryRes = await supabase.rpc("my_earnings_summary");
  if (summaryRes.error?.message.includes("earnings_not_contracted")) {
    return (
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Earnings</h1>
        <p className="text-sm text-charcoal-ink/70">You are paid by salary, so there are no per-task earnings to show here.</p>
      </div>
    );
  }
  const [scheduleRes, linesRes] = await Promise.all([
    supabase.rpc("my_fee_schedule"),
    supabase.from("earnings_ledger").select("id, kind, amount_kobo, earned_at, payout_id, is_test, calculation").order("earned_at", { ascending: false }).limit(300),
  ]);
  const summary = summaryRes.error ? null : summarySchema.safeParse(summaryRes.data);
  const schedule = scheduleRes.error ? null : myScheduleSchema.safeParse(scheduleRes.data);
  const lines = linesRes.error ? null : ledgerRowsSchema.safeParse(linesRes.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Earnings</h1>
        <p className="text-sm text-charcoal-ink/60">Every line below is one piece of work with the amount and how it was worked out. A mistake is fixed by a correction line, never by changing an old one.</p>
      </div>

      {!summary?.success ? (
        <p role="alert" className="text-sm text-red-600">Your totals could not be loaded. This is not the same as having earned nothing.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-charcoal-ink/60">Not yet paid out</p><p className="text-xl font-semibold">{formatKobo(summary.data.unpaid_kobo)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-charcoal-ink/60">Paid out</p><p className="text-xl font-semibold">{formatKobo(summary.data.paid_kobo)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-charcoal-ink/60">Lines waiting for a correction by operations</p><p className="text-xl font-semibold">{summary.data.needs_review}</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Your lines</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!lines?.success ? (
            <p role="alert" className="text-sm text-red-600">Your lines could not be loaded. This is not the same as having none.</p>
          ) : lines.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing yet. Lines appear when you finish a task or consultation, an on-call shift ends, or a lead month closes.</p>
          ) : (
            lines.data.map((l) => (
              <div key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-charcoal-ink/10 py-2 text-sm">
                <div>
                  <p className="font-medium">
                    {KIND_LABEL[l.kind] ?? l.kind} <span className="font-normal text-charcoal-ink/60">{dateTime(l.earned_at)}</span>
                    {l.payout_id ? <Badge variant="green" className="ml-2">Paid out</Badge> : null}
                  </p>
                  <p className="text-charcoal-ink/70">{explainLine(l)}</p>
                </div>
                <p className={l.amount_kobo < 0 ? "font-semibold text-red-600" : "font-semibold"}>{formatKobo(l.amount_kobo)}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>The fee schedule that applies to you</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!schedule?.success ? (
            <p role="alert" className="text-sm text-red-600">The schedule could not be loaded.</p>
          ) : !schedule.data.approved ? (
            <p className="text-charcoal-ink/70">No fee schedule has been approved yet. Work you finish now is kept and paid at the first schedule that is approved.</p>
          ) : (
            <>
              <p className="text-charcoal-ink/70">Version {schedule.data.version}, in force from {dateTime(schedule.data.approved_at)}.</p>
              <ul className="space-y-1">
                {Object.entries(schedule.data.items.task_types).map(([code, fee]) => (
                  <li key={code}>
                    <span className="font-mono text-xs">{code}</span>: {formatKobo(fee.base_fee_kobo)}
                    {fee.wait_multiplier_steps.map((s) => `, plus ${s.add_pct} percent if taken after ${s.at_pct} percent of the time`).join("")}
                  </li>
                ))}
                <li>On-call shift: {formatKobo(schedule.data.items.on_call_shift_fee_kobo)}</li>
                <li>Lead clinician: {formatKobo(schedule.data.items.lead_fee_per_patient_month_kobo)} per patient per month</li>
                <li>Pilot minimum: {formatKobo(schedule.data.items.pilot_minimum_per_declared_hour_kobo)} per declared hour</li>
                <li>Consultation share: video {schedule.data.items.consultation_share_pct.video} percent, audio {schedule.data.items.consultation_share_pct.audio} percent, phone {schedule.data.items.consultation_share_pct.phone} percent</li>
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
