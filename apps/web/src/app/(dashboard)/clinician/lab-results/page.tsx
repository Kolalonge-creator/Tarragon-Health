import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { ReviewCard } from "./review-card";

export default async function ClinicianLabResultsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "clinician") redirect("/");

  const supabase = await createClient();
  // Only the results this clinician is tied to are listed, with no patient values. Opening one is the audited read (INV-10):
  // it happens when the clinician clicks Open, once per open, never as a side effect of loading this page.
  const { data: queue } = await supabase.rpc("lab_results_review_queue");
  const rows = queue ?? [];

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
      {rows.length === 0 ? <p className="text-sm text-charcoal-ink/60">Nothing is waiting for you.</p> : null}
      {rows.map((r) => (
        <ReviewCard key={r.lab_result_id} summary={{ id: r.lab_result_id, state: r.release_state, reason: r.release_reason, receivedAt: r.received_at }} />
      ))}
    </div>
  );
}
