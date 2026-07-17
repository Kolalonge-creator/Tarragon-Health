"use client";

import { useState, type FormEvent } from "react";
import { useVaccinationCatalog, useLogVaccination } from "@/lib/queries/vaccination";
import { syncVaccinationScheduleAction } from "./vaccination-actions";
import { logVaccinationSchema } from "@/lib/validation/vaccination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function LogVaccinationForm({ patientId }: { patientId: string }) {
  const catalog = useVaccinationCatalog();
  const logVaccination = useLogVaccination();

  const [catalogId, setCatalogId] = useState("");
  const [doseNumber, setDoseNumber] = useState("1");
  const [dateAdministered, setDateAdministered] = useState("");
  const [provider, setProvider] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = logVaccinationSchema.safeParse({
      vaccination_catalog_id: catalogId,
      dose_number: doseNumber,
      date_administered: dateAdministered,
      provider: provider || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setSuccess(false);
    logVaccination.mutate(
      { ...parsed.data, patientId },
      {
        onSuccess: () => {
          setSuccess(true);
          setCatalogId("");
          setDoseNumber("1");
          setDateAdministered("");
          setProvider("");
          // Roll the persisted schedule (and its reminder) forward now the
          // dose is on file — fire-and-forget, never blocks the UI.
          void syncVaccinationScheduleAction();
        },
      }
    );
  }

  const mutationError = (logVaccination.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a vaccination</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vaccination_catalog_id">Vaccine</Label>
            <Select
              id="vaccination_catalog_id"
              value={catalogId}
              onChange={(event) => setCatalogId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select
              </option>
              {catalog.data?.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dose_number">Dose number</Label>
              <Input
                id="dose_number"
                type="number"
                min={1}
                max={20}
                value={doseNumber}
                onChange={(event) => setDoseNumber(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date_administered">Date given</Label>
              <Input
                id="date_administered"
                type="date"
                value={dateAdministered}
                onChange={(event) => setDateAdministered(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider (optional)</Label>
            <Input
              id="provider"
              placeholder="e.g. clinic or pharmacy name"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </div>
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && <p className="text-sm text-brand-green">Vaccination logged.</p>}
          <Button type="submit" disabled={logVaccination.isPending}>
            {logVaccination.isPending ? "Saving…" : "Log vaccination"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
