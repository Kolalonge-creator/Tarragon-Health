"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useVaccinationCatalog } from "@/lib/queries/vaccination";
import { markVaccinationContraindicatedAction } from "@/app/(dashboard)/clinician/vaccinations/actions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * A clinical-tier doctor's finding that a vaccine should not be given to
 * this patient (spec §43.3). Only rendered for a caller isClinicalTier() —
 * private.enforce_vaccination_non_administration's own is_clinical_tier
 * check is the real enforcement boundary; this is the friendly early gate,
 * same posture as every other clinical-tier-only form on this page.
 */
export function MarkVaccineContraindicatedForm({ patientId }: { patientId: string }) {
  const catalog = useVaccinationCatalog();
  const [catalogId, setCatalogId] = useState("");
  const [note, setNote] = useState("");
  const mark = useMutation({
    mutationFn: async () => {
      const result = await markVaccinationContraindicatedAction({
        patientId,
        vaccinationCatalogId: catalogId,
        note,
      });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setCatalogId("");
      setNote("");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mark a vaccine contraindicated</CardTitle>
        <CardDescription>
          Records a clinical finding that this vaccine should not be given, and stops it
          resurfacing as due. Document why: this becomes part of the patient&apos;s record.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Select value={catalogId} onChange={(event) => setCatalogId(event.target.value)}>
          <option value="" disabled>
            Select a vaccine
          </option>
          {(catalog.data ?? []).map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Reason (required)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {mark.error && <p className="text-xs text-red-600">{(mark.error as Error).message}</p>}
        {mark.isSuccess && <p className="text-xs text-brand-green">Recorded.</p>}
        <Button
          size="sm"
          disabled={mark.isPending || !catalogId || !note.trim()}
          onClick={() => mark.mutate()}
        >
          {mark.isPending ? "Saving…" : "Mark contraindicated"}
        </Button>
      </CardContent>
    </Card>
  );
}
