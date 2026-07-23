import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";

/**
 * "State of Health" aggregate view — the internal basis for an annual public
 * report (the Halodoc "Health Insights" trust-building pattern). Counts only,
 * org-scoped via the caller's own staff RLS, zero patient-level rows shown.
 * Publishing any of this externally is a founder decision made per figure —
 * this page just keeps the numbers honest and in one place.
 */
export default async function StateOfHealthPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01T00:00:00.000Z`;

  const [
    { count: patients },
    { count: screeningsCompleted },
    { count: abnormalCaught },
    { count: vaccinationsVerified },
    { count: checksResulted },
    { count: escalationsResolved },
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "patient"),
    supabase
      .from("screening_schedules")
      .select("id", { count: "exact", head: true })
      .eq("status", "completed"),
    supabase
      .from("screening_results")
      .select("id", { count: "exact", head: true })
      .in("result_status", ["abnormal", "critical"])
      .gte("created_at", yearStart),
    supabase
      .from("vaccination_records")
      .select("id", { count: "exact", head: true })
      .eq("verification_status", "verified"),
    supabase
      .from("lab_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "resulted")
      .gte("created_at", yearStart),
    supabase
      .from("escalations")
      .select("id", { count: "exact", head: true })
      .not("reviewed_at", "is", null),
  ]);

  const stats = [
    { label: "Patients on the platform", value: patients ?? 0 },
    { label: `Screenings completed (all time)`, value: screeningsCompleted ?? 0 },
    { label: `Abnormal results caught early (${year})`, value: abnormalCaught ?? 0 },
    { label: "Vaccinations doctor-verified", value: vaccinationsVerified ?? 0 },
    { label: `Lab orders resulted (${year})`, value: checksResulted ?? 0 },
    { label: "Escalations resolved by a doctor", value: escalationsResolved ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          State of Health — {year}
        </h1>
        <p className="text-charcoal-ink/60">
          Aggregate counts only, no patient-level data. This is the internal working basis for
          an annual public &ldquo;State of Nigerian Health&rdquo; report — publish any figure
          externally only after founder review, and never one small enough to identify anyone.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="py-5">
              <p className="font-heading text-3xl font-bold text-brand-green">
                {s.value.toLocaleString()}
              </p>
              <p className="mt-1 text-sm text-charcoal-ink/70">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
