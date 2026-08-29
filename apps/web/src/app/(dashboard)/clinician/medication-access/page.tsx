"use client";

import { useMedicationAccessDashboard } from "@/lib/queries/medication-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const ACCESS_STATUS_LABEL: Record<string, string> = {
  available: "Available",
  out_of_stock: "Out of stock",
  too_expensive: "Too expensive",
  awaiting_payment: "Awaiting payment",
  awaiting_delivery: "Awaiting delivery",
  unable_to_collect: "Unable to collect",
};

const ADHERENCE_STATUS_BADGE: Record<string, "green" | "amber" | "red" | "grey"> = {
  taking: "green",
  frequently_missed: "amber",
  not_taking: "red",
  unknown: "grey",
};

const BARRIER_LABEL: Record<string, string> = {
  too_expensive: "Cost",
  pharmacy_unavailable: "Pharmacy unavailable",
  out_of_stock: "Out of stock",
  prescription_issue: "Prescription issue",
  forgot: "Forgetting",
  other: "Other",
};

/**
 * Module 21 §21.15/§21.16 — the clinical-team medication access dashboard.
 * Answers "why isn't this patient taking the medicine", not merely an
 * adherence percentage: main_barrier and next_action are computed server-
 * side (medication_access_dashboard_v) from access_status, adherence
 * signals, open side-effect reports, and the missed-dose ladder together.
 */
export default function MedicationAccessDashboardPage() {
  const { data, isLoading, isError } = useMedicationAccessDashboard();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Medication access</h1>
        <p className="text-sm text-charcoal-ink/60">
          Patients whose medication isn&apos;t reaching them, or isn&apos;t being taken — and why.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load the medication access dashboard.</p>}
          {data && data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              Nothing needs attention right now — every active medication your panel is tracking is
              available and being taken.
            </p>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {data.map((row) => (
                <li key={row.medication_id} className="space-y-1.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {row.patient_name ?? "Patient"}
                    </p>
                    <Badge variant="blue">{row.drug_name}</Badge>
                    {row.care_plan_condition && (
                      <Badge variant="grey">{formatCondition(row.care_plan_condition)}</Badge>
                    )}
                    {row.adherence_status && (
                      <Badge variant={ADHERENCE_STATUS_BADGE[row.adherence_status] ?? "grey"}>
                        {row.adherence_pct_30d != null
                          ? `${row.adherence_pct_30d}% adherence`
                          : "Adherence unknown"}
                      </Badge>
                    )}
                    {row.access_status && row.access_status !== "available" && (
                      <Badge variant="amber">{ACCESS_STATUS_LABEL[row.access_status] ?? row.access_status}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-charcoal-ink/70">
                    Main barrier:{" "}
                    {row.main_barrier ? BARRIER_LABEL[row.main_barrier] ?? row.main_barrier : "None reported"}
                    {" · "}
                    Last refill:{" "}
                    {row.last_refill_date
                      ? new Date(row.last_refill_date).toLocaleDateString()
                      : "Not recorded"}
                  </p>
                  <p className="text-xs font-semibold text-brand-green">Next action: {row.next_action}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatCondition(condition: string): string {
  return condition
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
