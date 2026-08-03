"use client";

import { useState } from "react";
import {
  usePendingLabExtractions,
  useConfirmLabExtraction,
  type LabResultExtraction,
} from "@/lib/queries/lab-extractions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A clinician checks what the model read off an uploaded result before any of
 * it becomes clinical record.
 *
 * The values are EDITABLE on purpose: correcting a misread is the point of the
 * review, not an edge case. Unticking a row drops it. Nothing here writes
 * anything until "Confirm" is pressed, and confirming is stamped server-side to
 * the caller's own clinical_staff row by public.confirm_lab_result_extraction.
 *
 * The panel deliberately shows what was printed on the document next to the
 * converted value, so a unit conversion (mmol/L to mg/dL, IFCC to NGSP) is
 * something the clinician can see and check rather than take on trust.
 */
export function ExtractedResultsPanel({ patientId }: { patientId: string }) {
  const { data: extractions, isLoading } = usePendingLabExtractions(patientId);

  if (isLoading) return null;
  const pending = (extractions ?? []).filter((e) => e.status === "ready" && e.proposed.length > 0);
  const failed = (extractions ?? []).filter((e) => e.status === "failed" || e.proposed.length === 0);
  if (pending.length === 0 && failed.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Results read from uploads
          <Badge variant="amber">AI-drafted, not yet confirmed</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          These numbers were read off an uploaded document automatically. Nothing here is on the
          patient&apos;s record yet. Check them against the document, correct anything that is
          wrong, then confirm.
        </p>
        {pending.map((extraction) => (
          <ExtractionRow key={extraction.id} extraction={extraction} patientId={patientId} />
        ))}
        {failed.map((extraction) => (
          <div
            key={extraction.id}
            className="rounded-md border border-charcoal-ink/10 p-3 text-sm text-charcoal-ink/70"
          >
            Could not read{" "}
            <span className="font-medium">{extraction.documentFilename ?? "an upload"}</span>{" "}
            automatically. Open the document and record the values yourself.
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ExtractionRow({
  extraction,
  patientId,
}: {
  extraction: LabResultExtraction;
  patientId: string;
}) {
  const confirm = useConfirmLabExtraction(patientId);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(extraction.proposed.map((p) => [p.code, String(p.value)])),
  );
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(extraction.proposed.map((p) => [p.code, true])),
  );
  const [done, setDone] = useState(false);

  const takenOn = extraction.proposed.find((p) => p.takenOn)?.takenOn ?? null;

  const readings = extraction.proposed
    .filter((p) => included[p.code])
    .map((p) => ({ code: p.code, value: Number(values[p.code]), takenOn: p.takenOn }))
    .filter((r) => Number.isFinite(r.value));

  if (done) {
    return (
      <p className="rounded-md border border-brand-green/30 bg-brand-green/5 p-3 text-sm text-charcoal-ink">
        Confirmed. These values are on the patient&apos;s record and in their trends.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-charcoal-ink/10 p-3">
      <p className="text-xs text-charcoal-ink/60">
        From {extraction.documentFilename ?? "an upload"}
        {takenOn ? ` · sample dated ${takenOn}` : " · no sample date on the document"}
      </p>

      <ul className="space-y-2">
        {extraction.proposed.map((p) => (
          <li key={p.code} className="flex flex-wrap items-center gap-2">
            <input
              type="checkbox"
              id={`${extraction.id}-${p.code}`}
              checked={included[p.code] ?? false}
              onChange={(e) =>
                setIncluded((prev) => ({ ...prev, [p.code]: e.target.checked }))
              }
              className="h-4 w-4"
            />
            <Label htmlFor={`${extraction.id}-${p.code}`} className="min-w-[9rem] text-sm">
              {p.label}
            </Label>
            <Input
              className="w-28"
              inputMode="decimal"
              aria-label={`${p.label} value`}
              value={values[p.code] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [p.code]: e.target.value }))}
            />
            <span className="text-xs text-charcoal-ink/60">{p.unit}</span>
            <span className="text-xs text-charcoal-ink/45">read as &ldquo;{p.asPrinted}&rdquo;</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={readings.length === 0 || confirm.isPending}
          onClick={() =>
            confirm.mutate(
              { extractionId: extraction.id, readings },
              { onSuccess: () => setDone(true) },
            )
          }
        >
          {confirm.isPending ? "Confirming…" : `Confirm ${readings.length} value(s)`}
        </Button>
        {confirm.isError && (
          <p className="text-xs text-red-600">
            {(confirm.error as Error).message || "Could not confirm. Try again."}
          </p>
        )}
      </div>
    </div>
  );
}
