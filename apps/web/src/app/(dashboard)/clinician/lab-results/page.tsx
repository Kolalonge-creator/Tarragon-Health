import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { criticalCallsSchema, holdClockSchema, type HoldClockRow } from "@/lib/lab-results/lifecycle";
import { ReviewCard } from "./review-card";
import { CriticalCalls } from "./critical-calls";

export default async function ClinicianLabResultsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "clinician") redirect("/");

  const supabase = await createClient();
  // Only the results this clinician is tied to are listed, with no patient values. Opening one is the audited read (INV-10):
  // it happens when the clinician clicks Open, once per open, never as a side effect of loading this page.
  const { data: queue } = await supabase.rpc("lab_results_review_queue");
  const rows = queue ?? [];
  // S27h: the critical value calls this clinician is on, and the clock on every held result. A failed read is shown as a failure,
  // never as "no calls" and never as "nothing is late".
  const [callsRes, clockRes] = await Promise.all([loose(supabase).rpc("my_lab_critical_calls"), loose(supabase).rpc("lab_hold_clock")]);
  const calls = callsRes.error ? null : criticalCallsSchema.safeParse(callsRes.data);
  const clock = clockRes.error ? null : holdClockSchema.safeParse(clockRes.data);
  const clockById = new Map<string, HoldClockRow>(clock?.success ? clock.data.map((c) => [c.lab_result_id, c]) : []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Lab results to review</h1>
        <p className="text-charcoal-ink/60">
          Results for patients you are tied to that are held before the patient can see them. Opening one is recorded in the
          audit log. A result that needs a personal disclosure stays held until a senior clinician has told the patient. A
          critical value can be released only by a senior clinician.
        </p>
      </div>
      {calls?.success ? <CriticalCalls calls={calls.data} /> : <p role="alert" className="text-sm text-red-700">The critical value calls could not be loaded. This is not the same as there being none. Refresh, or ask the on-call clinician.</p>}
      {clock?.success ? null : <p role="alert" className="text-sm text-red-700">The waiting times could not be loaded.</p>}
      {rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">Nothing is waiting for you.</p> : null}
      {rows.map((r) => (
        <ReviewCard key={r.lab_result_id} summary={{ id: r.lab_result_id, state: r.release_state, reason: r.release_reason, receivedAt: r.received_at }} clock={clockById.get(r.lab_result_id) ?? null} />
      ))}
    </div>
  );
}
