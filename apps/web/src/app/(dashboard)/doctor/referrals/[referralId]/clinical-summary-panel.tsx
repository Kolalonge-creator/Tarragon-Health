"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { URGENCY_BADGE } from "@/lib/worklist/referral-urgency-badge";
import { useSetReferralUrgency, type SpecialistReferralWithDetails } from "@/lib/queries/specialist-referrals";
import type { ReferralUrgency } from "@tarragon/shared";
import { assembleAndSaveClinicalSummary } from "./actions";

interface ClinicalSummaryVital {
  vital_type: string;
  systolic: number | null;
  diastolic: number | null;
  glucose_mmol_l: number | null;
  pulse_bpm: number | null;
  weight_kg: number | null;
  spo2_pct: number | null;
  taken_at: string;
}

interface ClinicalSummaryMedication {
  drug_name: string;
  dose: string | null;
  frequency: string | null;
}

interface ClinicalSummary {
  vitals: ClinicalSummaryVital[];
  medications: ClinicalSummaryMedication[];
  triggering_result: {
    result_status: string;
    result_summary: string | null;
    abnormal_flags: string[];
    created_at: string;
  } | null;
  clinical_question: string | null;
  assembled_at: string;
}

function formatVital(vital: ClinicalSummaryVital): string {
  const date = new Date(vital.taken_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  if (vital.vital_type === "blood_pressure") return `${date}: BP ${vital.systolic}/${vital.diastolic}`;
  if (vital.vital_type === "glucose") return `${date}: Glucose ${vital.glucose_mmol_l} mmol/L`;
  if (vital.vital_type === "pulse") return `${date}: Pulse ${vital.pulse_bpm} bpm`;
  if (vital.vital_type === "weight") return `${date}: Weight ${vital.weight_kg} kg`;
  if (vital.vital_type === "spo2") return `${date}: SpO2 ${vital.spo2_pct}%`;
  return `${date}: ${vital.vital_type}`;
}

/**
 * Urgency selector + assembled clinical summary for a referral, plus a
 * print affordance — specialists have no platform login, so this is the
 * only way the summary reaches them (window.print() rather than a PDF
 * generator; @react-pdf/renderer already exists for Health Passport, but
 * pulling it in here is scope creep for a v1).
 */
export function ClinicalSummaryPanel({ referral }: { referral: SpecialistReferralWithDetails }) {
  const router = useRouter();
  const setUrgency = useSetReferralUrgency();
  const [urgency, setUrgencyLocal] = useState<ReferralUrgency | "">(referral.urgency ?? "");
  const [isPending, startTransition] = useTransition();
  const [assembleError, setAssembleError] = useState<string | null>(null);

  const summary = referral.clinical_summary as unknown as ClinicalSummary | null;

  return (
    <div className="space-y-4 print:space-y-2">
      <Card>
        <CardHeader>
          <CardTitle>Referral urgency</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-2">
          {referral.urgency && <Badge variant={URGENCY_BADGE[referral.urgency].variant}>{URGENCY_BADGE[referral.urgency].label}</Badge>}
          <div className="space-y-1 print:hidden">
            <Label htmlFor="urgency-select">Set urgency</Label>
            <Select
              id="urgency-select"
              value={urgency}
              onChange={(e) => setUrgencyLocal(e.target.value as ReferralUrgency)}
            >
              <option value="">Select urgency</option>
              <option value="routine">Routine — within weeks</option>
              <option value="priority">Priority — within days</option>
              <option value="urgent">Urgent — same day</option>
            </Select>
          </div>
          <Button
            size="sm"
            className="print:hidden"
            disabled={!urgency || setUrgency.isPending}
            onClick={() =>
              urgency &&
              setUrgency.mutate(
                { referralId: referral.id, urgency },
                { onSuccess: () => router.refresh() }
              )
            }
          >
            {setUrgency.isPending ? "Saving…" : "Save urgency"}
          </Button>
          {setUrgency.isError && <p className="w-full text-xs text-red-600">Could not save. Try again.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinical summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 print:hidden">
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  setAssembleError(null);
                  const result = await assembleAndSaveClinicalSummary(referral.id);
                  if (result?.error) {
                    setAssembleError(result.error);
                  } else {
                    router.refresh();
                  }
                })
              }
            >
              {isPending ? "Assembling…" : summary ? "Refresh summary" : "Assemble summary"}
            </Button>
            {summary && (
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                Print
              </Button>
            )}
          </div>
          {assembleError && <p className="text-xs text-red-600">{assembleError}</p>}

          {!summary && <p className="text-sm text-charcoal-ink/60">No summary assembled yet.</p>}

          {summary && (
            <div className="space-y-3 text-sm text-charcoal-ink">
              {summary.clinical_question && (
                <div>
                  <p className="font-medium">Clinical question</p>
                  <p className="text-charcoal-ink/70">{summary.clinical_question}</p>
                </div>
              )}
              {summary.triggering_result && (
                <div>
                  <p className="font-medium">Triggering result</p>
                  <p className="text-charcoal-ink/70">
                    {summary.triggering_result.result_status} —{" "}
                    {summary.triggering_result.result_summary ?? "no summary on file"}
                  </p>
                </div>
              )}
              <div>
                <p className="font-medium">Recent vitals</p>
                {summary.vitals.length === 0 && <p className="text-charcoal-ink/60">No vitals on file.</p>}
                <ul className="text-charcoal-ink/70">
                  {summary.vitals.map((v, i) => (
                    <li key={i}>{formatVital(v)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium">Active medications</p>
                {summary.medications.length === 0 && <p className="text-charcoal-ink/60">None on file.</p>}
                <ul className="text-charcoal-ink/70">
                  {summary.medications.map((m, i) => (
                    <li key={i}>
                      {m.drug_name}
                      {m.dose && ` — ${m.dose}`}
                      {m.frequency && ` (${m.frequency})`}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-xs text-charcoal-ink/40">
                Assembled {new Date(summary.assembled_at).toLocaleString("en-GB")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
