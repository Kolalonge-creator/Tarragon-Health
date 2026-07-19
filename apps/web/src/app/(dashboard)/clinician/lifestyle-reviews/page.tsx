import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LifestyleReviewsClient, type PendingReview } from "./lifestyle-reviews-client";

/**
 * Clinician worklist for periodic lifestyle reviews (spec §12). Org-staff gated
 * (defense in depth on RLS). Completing a review server-stamps reviewed_by and
 * rolls the next one at the condition cadence.
 */
export default async function LifestyleReviewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) redirect("/");

  const { data: reviews } = await supabase
    .from("lpe_reviews")
    .select("id, patient_id, due_date, enrollment_id, lpe_enrollments(condition)")
    .eq("status", "pending")
    .order("due_date", { ascending: true });

  const patientIds = [...new Set((reviews ?? []).map((r) => r.patient_id))];
  const nameById = new Map<string, string>();
  if (patientIds.length) {
    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", patientIds);
    for (const p of people ?? []) nameById.set(p.id, p.full_name ?? "Patient");
  }

  const pending: PendingReview[] = (reviews ?? []).map((r) => ({
    id: r.id,
    patientName: nameById.get(r.patient_id) ?? "Patient",
    condition:
      (r.lpe_enrollments as { condition: string } | null)?.condition ?? "lifestyle",
    dueDate: r.due_date,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lifestyle reviews</h1>
        <p className="text-muted-foreground text-sm">
          Periodic check-ins on patients&apos; lifestyle programmes. Completing
          one schedules the next automatically.
        </p>
      </div>
      <LifestyleReviewsClient reviews={pending} />
    </div>
  );
}
