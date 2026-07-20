import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Clinician reference: the WHO / FMOH metformin-first stepped ladder (§13.2)
 * and insulin-titration note (§13.4). Reference content, NOT a signed protocol
 * or an auto-prescription — the doctor decides. Sits alongside the add-
 * medication form so the ladder is at hand at prescribe time.
 */
const STEPS: { step: string; regimen: string; note: string }[] = [
  {
    step: "Step 1",
    regimen: "Lifestyle + Metformin",
    note: "Start 500mg once/twice daily with food; titrate over weeks toward 1g twice daily (max ~2g/day). Check eGFR first.",
  },
  {
    step: "Step 2",
    regimen: "Add a second agent",
    note: "Sulfonylurea (gliclazide preferred) or, where affordable, a DPP-4i (sitagliptin) or SGLT2i (empagliflozin/dapagliflozin, cardio-renal benefit).",
  },
  {
    step: "Step 3",
    regimen: "Add a third agent OR start basal insulin",
    note: "Guided by control, hypo risk, weight, cardio-renal disease and affordability.",
  },
  {
    step: "Step 4",
    regimen: "Insulin intensification",
    note: "Basal → basal-plus → basal-bolus, or twice-daily premixed. Titrate against the patient's logged glucose.",
  },
  {
    step: "Any step",
    regimen: "Insulin now if catabolic / ketotic / very high",
    note: "Marked hyperglycaemia with weight loss or ketones — do not delay insulin; exclude type 1 and involve a specialist.",
  },
];

export function TreatmentLadder() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Type 2 treatment ladder — reference (§13.2)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-charcoal-ink/60">
          WHO / Nigeria FMOH stepped approach. Reference only — confirm the current partner
          formulary and individualise; this is not a signed protocol or an auto-prescription.
        </p>
        <div className="divide-y divide-charcoal-ink/10">
          {STEPS.map((s) => (
            <div key={s.step} className="grid gap-1 py-2 sm:grid-cols-[7rem_1fr]">
              <div className="text-sm font-medium text-deep-forest">{s.step}</div>
              <div>
                <p className="text-sm text-charcoal-ink">{s.regimen}</p>
                <p className="text-xs text-charcoal-ink/60">{s.note}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
