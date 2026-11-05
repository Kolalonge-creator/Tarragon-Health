import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BASELINE_ITEM_LABELS } from "@/lib/validation/preventive-plan";
import type { PlanItem } from "@/lib/queries/preventive-plan";
import { PreventivePlanReviewForm } from "./preventive-plan-review-form";

type ClinicianBaseline = {
  baseline: {
    id: string;
    state: "submitted" | "authorised" | "adjusted";
    submitted_at: string;
    reviewed_at: string | null;
    review_note: string | null;
    reviewed_by_name: string | null;
  } | null;
  items: { code: string; required: boolean; done: boolean }[];
  plan: PlanItem[];
};

/**
 * T2 Phase 3: the doctor's view of a Member's baseline assessment and the plan the signed screening rules produced. Read through
 * public.clinician_preventive_baseline (tied clinicians only, audited). Rendered for clinical-tier staff only; renders nothing when
 * there is no baseline. The database lets a tied clinician mark an item not applicable (set_screening_state) or move it
 * (defer_screening); per-item controls for that on this page are NOT built yet, so today an adjustment is recorded in the note.
 */
export async function PreventivePlanReviewPanel({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clinician_preventive_baseline", { p_patient: patientId });
  if (error || !data) return null;
  const d = data as unknown as ClinicianBaseline;
  const b = d.baseline;
  if (!b || !Array.isArray(d.items) || !Array.isArray(d.plan)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Baseline preventive plan
          {b.state === "submitted" ? <Badge variant="amber">Needs review</Badge> : <Badge variant="green">{b.state === "authorised" ? "Authorised" : "Adjusted"}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {d.items.map((i) => (
            <li key={i.code} className="flex items-center gap-2">
              <span className={i.done ? "text-emerald-700" : "text-gray-500"}>{i.done ? "Yes" : "No"}</span>
              <span>{BASELINE_ITEM_LABELS[i.code]?.label ?? i.code}</span>
            </li>
          ))}
        </ul>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-gray-500">
              <th className="py-1 font-medium">Check</th>
              <th className="py-1 font-medium">Due</th>
              <th className="py-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.plan.map((p) => (
              <tr key={p.schedule_id} className="border-t border-gray-200">
                <td className="py-1">
                  {p.name}
                  {p.sensitive && <span className="ml-2 text-amber-700">sensitive: eligibility and consent first</span>}
                </td>
                <td className="py-1">{p.due_date}{p.original_due_date ? ` (was ${p.original_due_date})` : ""}</td>
                <td className="py-1">{p.status}{p.reason_code ? ` (${p.reason_code})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {b.state === "submitted" ? (
          <PreventivePlanReviewForm patientId={patientId} baselineId={b.id} />
        ) : (
          <p className="text-xs text-gray-600">
            {b.reviewed_by_name ? `Reviewed by ${b.reviewed_by_name}` : "Reviewed"}
            {b.reviewed_at ? ` on ${b.reviewed_at.slice(0, 10)}` : ""}
            {b.review_note ? `: ${b.review_note}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
