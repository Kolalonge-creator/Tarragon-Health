import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { URINALYSIS_FIELDS, type MyPocResults } from "@/lib/testing-days/model";

const KIND_LABEL = { urinalysis: "Urine test", hba1c: "Sugar control (HbA1c)" } as const;
const FLAG_LABEL: Record<string, string> = {
  normal: "In the usual range",
  abnormal: "Outside the usual range",
  low: "Below the usual range",
  high: "Above the usual range",
  critical: "Needs attention",
};
const ECG_CLASS_LABEL = { normal: "Normal", abnormal: "Needs a closer look", urgent: "Your care team will contact you" } as const;

function analyteLabel(code: string): string {
  return URINALYSIS_FIELDS.find((f) => f.code === code)?.label ?? (code === "hba1c" ? "HbA1c" : code);
}

/**
 * Only released point-of-care results reach this component (the database function returns nothing else, INV-03). The
 * machine's own wording on an ECG is never returned: the patient reads the doctor's words only.
 */
export function PocResultsList({ results }: { results: MyPocResults }) {
  if (results.results.length === 0 && results.ecgs.length === 0) return null;
  return (
    <section aria-labelledby="poc-results" className="space-y-3">
      <h2 id="poc-results" className="font-heading text-lg font-semibold text-charcoal-ink">
        Results from your visit
      </h2>
      {results.results.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle>{KIND_LABEL[r.kind]}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-charcoal-ink">
              {(r.items ?? []).map((i) => (
                <li key={i.analyte_code} className="flex justify-between gap-4">
                  <span>{analyteLabel(i.analyte_code)}</span>
                  <span>
                    {i.value_numeric ?? i.value_text} {i.unit} <span className="text-charcoal-ink/60">({FLAG_LABEL[i.flag] ?? i.flag})</span>
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {results.ecgs.map((e) => (
        <Card key={e.id}>
          <CardHeader>
            <CardTitle>Heart tracing (ECG)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-charcoal-ink">
            {e.interpretation_class ? <p className="font-medium">{ECG_CLASS_LABEL[e.interpretation_class]}</p> : null}
            <p>{e.interpretation}</p>
            <p className="text-xs text-charcoal-ink/60">Read by a doctor.</p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
