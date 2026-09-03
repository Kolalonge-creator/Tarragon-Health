"use client";

// Missing since this card was added, which threw "Attempted to call useQuery()
// from the server" and took the whole patient dashboard down with it — the
// hook below is a client hook, so the file has to declare the boundary.
import { usePatientRiskSignals } from "@/lib/queries/health-score";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";
import { ResultExplainer } from "@/components/result-explainer";
import type { Enums } from "@tarragon/shared";

const SCORE_TYPE_LABEL: Record<string, string> = {
  cvd_10yr: "Heart & circulation risk",
  hba1c_trajectory: "Blood sugar trend",
  bp_control: "Blood pressure control",
  heart_rate_pattern: "Heart rate pattern",
  // Predictive Risk & Early Warning Engine (spec §39) — an ACTIVE model's
  // prediction mirrors here with score_type 'predictive_<domain>' (see
  // private.record_risk_prediction, 20260829094021_risk_predictions_and_outcomes.sql).
  // Only the one reference domain built so far has a label; an unmapped
  // future domain falls back to its raw score_type below, same as any other
  // unmapped score_type today.
  predictive_missed_follow_up: "Staying on top of appointments",
};

/** Plain-language, non-alarmist gloss per risk_level — null for "low" means
 * a normal reading is never listed as something to worry about. */
const RISK_LEVEL_COPY: Record<Enums<"risk_level">, string | null> = {
  low: null,
  moderate: "being watched a little more closely than usual",
  high: "getting extra attention from your care team",
  very_high: "a current focus for your care team",
  // patient_risk_scores (the table this card reads) never writes 'unknown'
  // today — only prevention_risk_scores does — but risk_level is a shared
  // DB enum, so this Record must stay exhaustive.
  unknown: null,
};

/**
 * Closes a real gap: patient_risk_scores changes have always driven
 * clinician worklists/outreach with zero patient-facing surface at all — a
 * patient could get contacted with no idea why. This never shows a raw
 * score or explains the underlying algorithm; it's a plain-English "here's
 * roughly what's shaping your care" gloss, framed as informational context
 * rather than a precise causal explanation for any one contact.
 */
export function RiskSignalsCard({ patientId }: { patientId: string }) {
  const { data } = usePatientRiskSignals(patientId);

  if (!data || data.length === 0) return null;

  const elevated = data.filter(
    (row): row is typeof row & { risk_level: Enums<"risk_level"> } =>
      row.risk_level != null && RISK_LEVEL_COPY[row.risk_level] != null
  );
  const lastUpdated = data[0].computed_at;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SEMANTIC_ICON.escalation className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          What your care team is watching
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {elevated.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">
            Your recent readings and risk checks are within the normal range —
            nothing here needs extra attention right now.
          </p>
        ) : (
          <>
            <p className="text-sm text-charcoal-ink/60">
              A plain-language look at what&apos;s shaping your care, not a diagnosis.
              If your care team reaches out, this is usually part of why.
            </p>
            <ul className="space-y-1.5">
              {elevated.map((row) => {
                const label = SCORE_TYPE_LABEL[row.score_type] ?? row.score_type;
                return (
                  <li key={row.score_type} className="text-sm text-charcoal-ink">
                    <span className="font-medium">{label}</span>
                    {": "}
                    {RISK_LEVEL_COPY[row.risk_level]}
                    <ResultExplainer
                      kind="risk_score"
                      subjectKey={row.score_type}
                      label={label}
                      defaultOpen={row.risk_level === "high" || row.risk_level === "very_high"}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="text-xs text-charcoal-ink/40">
          Last updated {new Date(lastUpdated).toLocaleDateString()}
        </p>
      </CardContent>
    </Card>
  );
}
