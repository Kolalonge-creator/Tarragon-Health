"use client";

import { useMedications } from "@/lib/queries/medications";
import { useHbpmSummary, useBpSecondaryFlags } from "@/lib/queries/bp";
import { bpDrugClass, inferBpLadderStep } from "@/lib/rules/bp-drug-class";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SECONDARY_FLAG_LABEL: Record<string, string> = {
  young_onset_under_40:
    "Confirmed hypertension under age 40 — assess for a secondary cause (§7.3).",
  resistant_htn:
    "Above target on ≥3 antihypertensives including a diuretic — resistant HTN: confirm adherence, exclude secondary causes / white-coat, consider referral (§18.6).",
};

// Nigeria HEARTS stepped ladder (§12.3) — display copy mirrors the admin-editable
// public.bp_ladder_steps catalogue. Decision SUPPORT: the doctor authorises every
// step; this never prescribes.
const LADDER: { step: number; regimen: string; note: string }[] = [
  { step: 1, regimen: "Amlodipine 5 mg once daily", note: "First-line; no blood monitoring." },
  { step: 2, regimen: "Amlodipine 5 mg + Losartan 50 mg (SPC preferred)", note: "Telmisartan preferable if available. Check U&E/K⁺ around ARB start." },
  { step: 3, regimen: "Amlodipine 10 mg + Losartan 100 mg (SPC)", note: "Up-titrate both components." },
  { step: 4, regimen: "+ Hydrochlorothiazide 25 mg (or amiloride/HCTZ)", note: "Check electrolytes." },
  { step: 5, regimen: "Refer — specialist / consider spironolactone", note: "Resistant HTN: confirm adherence, exclude secondary causes first." },
];

const SAFETY_NOTES = [
  "ARB preferred over ACE inhibitor throughout (Black-African evidence, §12.4).",
  "Never combine an ACE inhibitor and an ARB (system-blocked).",
  "Check U&E + potassium before and 1–2 weeks after starting/increasing an ARB or diuretic; hold & refer if creatinine rises >30%, eGFR falls >25%, or K⁺ >5.5.",
  "Advance one step if not at target after ~4 weeks and adherence/technique are good.",
];

export function BpLadderPanel({ patientId }: { patientId: string }) {
  const { data: meds } = useMedications(patientId);
  const { data: hbpm } = useHbpmSummary(patientId);
  const { data: secondary } = useBpSecondaryFlags(patientId);

  const secondaryFlags = secondary?.flags ?? [];
  const bpMeds = (meds ?? []).filter((m) => bpDrugClass(m.drug_name) != null);
  const currentStep = inferBpLadderStep(bpMeds.map((m) => m.drug_name));
  const atTarget = hbpm?.average?.at_target ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hypertension drug ladder (Nigeria HEARTS)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80">
          Current position (inferred from active medications):{" "}
          <span className="font-semibold">
            {currentStep === 0 ? "not started" : `Step ${currentStep}`}
          </span>
          {atTarget !== null && (
            <>
              {" · 7-day home average "}
              <span className={atTarget ? "text-emerald-700" : "text-amber-700"}>
                {atTarget ? "at target" : "above target"}
              </span>
            </>
          )}
        </p>

        <ol className="space-y-1.5">
          {LADDER.map((s) => (
            <li
              key={s.step}
              className={`rounded-md px-3 py-2 text-sm ${
                s.step === currentStep
                  ? "bg-deep-forest/10 ring-1 ring-deep-forest/30"
                  : "bg-charcoal-ink/5"
              }`}
            >
              <span className="font-medium text-charcoal-ink">Step {s.step}: {s.regimen}</span>
              <span className="block text-xs text-charcoal-ink/60">{s.note}</span>
            </li>
          ))}
        </ol>

        <ul className="list-disc space-y-1 pl-5 text-xs text-charcoal-ink/70">
          {SAFETY_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>

        {secondaryFlags.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="text-xs font-semibold text-amber-800">
              Secondary-cause / resistance flags
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-900">
              {secondaryFlags.map((f) => (
                <li key={f}>{SECONDARY_FLAG_LABEL[f] ?? f}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-charcoal-ink/60">
          Baseline work-up: order the Hypertension Panel (U&E/eGFR, electrolytes,
          lipids, HbA1c, urinalysis, urine ACR) and record a 12-lead ECG for every
          newly confirmed patient (§8).
        </p>
      </CardContent>
    </Card>
  );
}
