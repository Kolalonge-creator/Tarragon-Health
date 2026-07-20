"use client";

import { useMedications } from "@/lib/queries/medications";
import { useHbpmSummary } from "@/lib/queries/bp";
import { bpDrugClass, inferBpLadderStep } from "@/lib/rules/bp-drug-class";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
      </CardContent>
    </Card>
  );
}
