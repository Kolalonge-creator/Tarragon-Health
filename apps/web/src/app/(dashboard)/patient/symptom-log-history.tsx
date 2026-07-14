"use client";

import { useSymptomLogs } from "@/lib/queries/symptoms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

const SYMPTOM_LABEL: Record<string, string> = {
  pain: "Pain",
  fatigue: "Fatigue",
  breathlessness: "Breathlessness",
  dizziness: "Dizziness",
  palpitations: "Palpitations",
  swelling: "Swelling",
  nausea: "Nausea",
  other: "Other",
};

export function SymptomLogHistory({ patientId }: { patientId: string }) {
  const { data, isLoading, isError } = useSymptomLogs(patientId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.escalation className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Recent symptoms
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your symptom log.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No symptoms logged yet.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((symptom) => (
              <li key={symptom.id} className="flex items-center justify-between gap-4 py-2">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    {SYMPTOM_LABEL[symptom.symptom_type] ?? symptom.symptom_type} — severity{" "}
                    {symptom.severity ?? "—"}/10
                    {symptom.is_red_flag && (
                      <Badge variant="red" className="ml-2">
                        Flagged for review
                      </Badge>
                    )}
                  </p>
                  {symptom.description && (
                    <p className="text-xs text-charcoal-ink/60">{symptom.description}</p>
                  )}
                </div>
                <span className="text-xs text-charcoal-ink/60">
                  {new Date(symptom.reported_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
