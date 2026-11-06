import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadErrorCard } from "@/components/ui/load-error-card";
import { SuggestedPlaceButton } from "@/components/diagnostic-directory/suggested-place-button";

const OPEN = ["ordered", "booked"];

/**
 * Patient: imaging a doctor has requested and not yet done (diagnostic directory Phase 5). Each has a printable request and,
 * when the doctor suggested one, a place to go. Reports come back through the existing upload (ImagingReportDocuments).
 */
export async function ImagingRequestsList({ patientId }: { patientId: string }) {
  const { data, error } = await loose(await createClient())
    .from("imaging_orders")
    .select("id, created_at, status, urgency, indication, study:imaging_studies(name)")
    .eq("patient_id", patientId)
    .in("status", OPEN)
    .order("created_at", { ascending: false });
  if (error) return <LoadErrorCard title="Your imaging requests" what="your imaging requests" />;
  const orders = (Array.isArray(data) ? data : []) as { id: string; created_at: string; urgency: string; indication: string; study: { name: string } | null }[];
  if (orders.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Your imaging requests</CardTitle></CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {orders.map((o) => (
            <li key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium text-charcoal-ink">{o.study?.name ?? "Imaging study"}</p>
              <p className="text-xs text-charcoal-ink/60">Requested {formatPatientDate(o.created_at)}{o.urgency !== "routine" ? ` · ${o.urgency}` : ""}</p>
              <a href={`/api/patient/imaging-order/${o.id}/request`} className="inline-block text-sm font-semibold text-brand-green hover:underline">
                Download your imaging request
              </a>
              <SuggestedPlaceButton kind="imaging" orderId={o.id} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
