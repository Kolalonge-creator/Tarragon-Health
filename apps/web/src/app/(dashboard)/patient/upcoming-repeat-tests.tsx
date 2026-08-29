import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatDueDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Result Lifecycle §58.16 — the patient-facing half of a recall: "a
 * clinician recommended repeating this test around <date>," plain-language,
 * no clinical jargon (§58.12). Renders nothing if the patient has no
 * scheduled/reminded recall — this is deliberately quiet, not alarming; the
 * reminder itself (private.send_result_recall_reminders) is what actually
 * prompts the patient, this is just the durable record.
 */
export async function UpcomingRepeatTests({ patientId }: { patientId: string }) {
  const supabase = await createClient();

  const { data: recalls } = await supabase
    .from("result_recalls")
    .select("id, repeat_due_date, status, screen_type_code, screen_type:screen_types!result_recalls_screen_type_code_fkey(name)")
    .eq("patient_id", patientId)
    .in("status", ["scheduled", "reminded"])
    .order("repeat_due_date", { ascending: true });

  if (!recalls || recalls.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming repeat tests</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recalls.map((recall) => {
          const overdue = new Date(recall.repeat_due_date) < new Date();
          const testName = recall.screen_type?.name ?? recall.screen_type_code ?? "a test";
          return (
            <div
              key={recall.id}
              className="flex items-start justify-between gap-3 border-b border-charcoal-ink/10 pb-3 last:border-0 last:pb-0"
            >
              <p className="text-sm text-charcoal-ink">
                A clinician recommended repeating your <span className="font-medium">{testName}</span> around{" "}
                {formatDueDate(recall.repeat_due_date)}.
              </p>
              {overdue && <Badge variant="amber">Due</Badge>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
