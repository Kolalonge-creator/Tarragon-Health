"use client";

import Link from "next/link";
import { useMyPreventiveBaseline, useSubmitPreventiveBaseline, type PlanItem } from "@/lib/queries/preventive-plan";
import { BASELINE_ITEM_LABELS } from "@/lib/validation/preventive-plan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPatientDate } from "@/lib/format-date";

/**
 * T2 Phase 3 (brief 6.1 A, 6.2): one baseline assessment for a new Member. It gathers what is already on record (questionnaire,
 * blood pressure, weight, height, waist, history, medicines, previous tests), builds the personal screening plan from the signed
 * screening rules, and sends it to a doctor to review. Shown only for the person's own record; Free members see nothing here.
 * A sensitive test (HIV, hepatitis and similar) is never shown as simply "due": the patient decides with their doctor first.
 */
export function PreventiveBaselineCard({ patientId }: { patientId: string }) {
  const { data, isLoading } = useMyPreventiveBaseline(patientId);
  const submit = useSubmitPreventiveBaseline(patientId);

  if (isLoading || !data || !data.eligible) return null;
  const required = data.items.filter((i) => i.required);
  const optional = data.items.filter((i) => !i.required);
  const ready = required.every((i) => i.done);
  const b = data.baseline;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your baseline health assessment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!b && (
          <>
            <p>
              A few measurements and answers let us plan the checks that suit you, rather than the same large panel for everyone.
              A doctor then reviews your plan.
            </p>
            <ul className="space-y-1">
              {required.map((i) => (
                <ItemLine key={i.code} code={i.code} done={i.done} />
              ))}
            </ul>
            <details>
              <summary className="cursor-pointer text-xs font-medium">Also helpful, if they apply to you</summary>
              <ul className="mt-2 space-y-1">
                {optional.map((i) => (
                  <ItemLine key={i.code} code={i.code} done={i.done} />
                ))}
              </ul>
            </details>
            {submit.error && <p className="text-xs text-red-600 dark:text-red-300">{(submit.error as Error).message}</p>}
            <Button type="button" size="sm" disabled={!ready || submit.isPending} onClick={() => submit.mutate()}>
              {submit.isPending ? "Sending" : "Send my assessment for review"}
            </Button>
            {!ready && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Add the items above first.</p>}
          </>
        )}
        {b && (
          <>
            <div className="flex items-center gap-2">
              <p>Sent {formatPatientDate(b.submitted_at.slice(0, 10))}.</p>
              {b.state === "submitted" && <Badge variant="amber">Waiting for a doctor</Badge>}
              {b.state !== "submitted" && <Badge variant="green">Reviewed by a doctor</Badge>}
            </div>
            {b.review_note && <p className="rounded-md bg-gray-50 p-2 text-xs dark:bg-white/5">The doctor&apos;s note: {b.review_note}</p>}
            <PlanTable plan={data.plan} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ItemLine({ code, done }: { code: string; done: boolean }) {
  const item = BASELINE_ITEM_LABELS[code];
  if (!item) return null;
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{item.label}</span>
      {done ? (
        <Badge variant="green">Done</Badge>
      ) : (
        <Link href={item.href} className="text-xs font-medium text-emerald-800 underline dark:text-emerald-300">
          Add
        </Link>
      )}
    </li>
  );
}

function planStatus(p: PlanItem): string {
  if (p.status === "declined") return "Not for me";
  if (p.status === "not_applicable") return "Not needed";
  if (p.needs_choice) return "Your choice first: discuss it with your care team";
  if (p.deferred) return "Moved";
  if (p.status === "booked") return "Booked";
  return p.status === "overdue" ? "Overdue" : "Due";
}

function PlanTable({ plan }: { plan: PlanItem[] }) {
  if (plan.length === 0) {
    return <p className="text-xs">No checks are due for you yet. We will tell you when one is.</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-charcoal-ink/60 dark:text-night-ink/60">
          <th className="py-1 font-medium">Check</th>
          <th className="py-1 font-medium">When</th>
          <th className="py-1 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {plan.map((p) => (
          <tr key={p.schedule_id} className="border-t border-charcoal-ink/10 dark:border-night-ink/15">
            <td className="py-1">{p.name}</td>
            <td className="py-1">{p.needs_choice ? "As agreed" : formatPatientDate(p.due_date)}</td>
            <td className="py-1">{planStatus(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
