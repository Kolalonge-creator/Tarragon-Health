import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { turnaroundOverviewSchema } from "@/lib/lab-results/lifecycle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Lab turnaround" };
export const dynamic = "force-dynamic";

/**
 * Lab turnaround (S27h): per laboratory, the samples still in flight, open delay alerts, samples rejected in the last 30 days, re-collections
 * still open and the median time to complete. No patient is named. The partner portal has its own view of the same specimens.
 */
export default async function AdminLabTurnaroundPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const { data, error } = await loose(await createClient()).rpc("lab_turnaround_overview");
  const parsed = error ? null : turnaroundOverviewSchema.safeParse(data);

  return (
    <div className="space-y-6">
      <PageHeader title="Lab turnaround" description="How long samples are taking at each laboratory, what is late, and which samples were rejected and need collecting again." />
      <Card>
        <CardHeader><CardTitle>Laboratories</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!parsed?.success && <p role="alert" className="text-sm text-red-600">The turnaround figures could not be loaded. This is not the same as everything being on time.</p>}
          {parsed?.success && parsed.data.length === 0 && <p className="text-sm text-charcoal-ink/60">No laboratories yet.</p>}
          {parsed?.success && parsed.data.map((r) => (
            <div key={r.provider_id} className="space-y-1 border-b border-charcoal-ink/10 pb-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.provider_name}{r.is_active ? "" : " (not active)"}</span>
                {r.open_delay_alerts > 0 ? <Badge variant="red">{r.open_delay_alerts} late</Badge> : <Badge variant="green">On time</Badge>}
              </div>
              <p className="text-charcoal-ink/70">
                In flight: {r.specimens_in_flight}. Completed in 30 days: {r.completed_30d}
                {r.median_hours_to_complete_30d !== null ? `, median ${r.median_hours_to_complete_30d} hours` : ""}.
                Rejected in 30 days: {r.rejected_30d}. Collecting again: {r.recollections_open}.
                {r.oldest_open_alert_hours !== null ? ` Oldest late sample: ${r.oldest_open_alert_hours} hours.` : ""}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
