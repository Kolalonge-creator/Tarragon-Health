import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LABEL: Record<string, string> = { retinal: "Eye (retinal) screening", renal: "Kidney check (eGFR + ACR)" };

/**
 * Patient-facing view of their latest eye + kidney surveillance checks (§18.2,
 * §18.3). Null-gated — shows nothing until a clinician records a check, so it
 * never implies a check that didn't happen.
 */
export async function ComplicationStatus({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("diabetes_complication_checks")
    .select("check_type, done_at, next_due_at, outcome")
    .eq("patient_id", patientId)
    .order("done_at", { ascending: false });

  if (!data || data.length === 0) return null;

  // Latest per type.
  const latest = new Map<string, (typeof data)[number]>();
  for (const row of data) if (!latest.has(row.check_type)) latest.set(row.check_type, row);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your eye &amp; kidney checks</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {[...latest.values()].map((row) => (
          <div key={row.check_type} className="flex flex-wrap justify-between gap-x-4">
            <span className="text-charcoal-ink">{LABEL[row.check_type] ?? row.check_type}</span>
            <span className="text-charcoal-ink/60">
              Done {new Date(row.done_at).toLocaleDateString()}
              {row.next_due_at ? ` · next due ${new Date(row.next_due_at).toLocaleDateString()}` : ""}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
