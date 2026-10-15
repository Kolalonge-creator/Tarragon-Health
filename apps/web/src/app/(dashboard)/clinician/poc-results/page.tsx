import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { pocQueueSchema } from "@/lib/testing-days/model";
import { PocQueue } from "./poc-queue";

export const metadata = { title: "Point-of-care results to review" };

export default async function ClinicianPocResultsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "clinician") redirect("/");

  const supabase = await createClient();
  const { data } = await supabase.rpc("poc_review_queue");
  const queue = pocQueueSchema.catch({ results: [], ecgs: [] }).parse(data ?? { results: [], ecgs: [] });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Testing-day results to review</h1>
        <p className="text-charcoal-ink/60">
          Urine strip and HbA1c results from testing days and employer visits, and ECG traces waiting to be read, for patients you
          are tied to. Nothing here is shown to the member until you release it. An ECG is never read by software: you write the
          interpretation, and that is what the member sees.
        </p>
      </div>
      <PocQueue queue={queue} />
    </div>
  );
}
