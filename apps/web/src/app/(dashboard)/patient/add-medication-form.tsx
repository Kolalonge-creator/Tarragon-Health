"use client";

import { useState, type FormEvent } from "react";
import { useAddMedication } from "@/lib/queries/medications";
import { medicationSchema } from "@/lib/validation/medications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AddMedicationForm({
  patientId,
  source,
}: {
  patientId: string;
  source: "patient" | "clinician";
}) {
  const addMedication = useAddMedication();
  const [drugName, setDrugName] = useState("");
  const [dose, setDose] = useState("");
  const [frequency, setFrequency] = useState("");
  const [refillDate, setRefillDate] = useState("");
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
  const [newTime, setNewTime] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function addTime() {
    if (newTime && !scheduleTimes.includes(newTime)) {
      setScheduleTimes((prev) => [...prev, newTime].sort());
      setNewTime("");
    }
  }

  function removeTime(time: string) {
    setScheduleTimes((prev) => prev.filter((t) => t !== time));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = medicationSchema.safeParse({
      drug_name: drugName,
      dose: dose || undefined,
      frequency: frequency || undefined,
      refill_date: refillDate || undefined,
      schedule_times: scheduleTimes,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    setSuccess(false);
    addMedication.mutate(
      { ...parsed.data, patientId, source },
      {
        onSuccess: () => {
          setSuccess(true);
          setDrugName("");
          setDose("");
          setFrequency("");
          setRefillDate("");
          setScheduleTimes([]);
        },
      }
    );
  }

  const mutationError = (addMedication.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a medication</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="drug_name">Drug name</Label>
            <Input
              id="drug_name"
              value={drugName}
              onChange={(event) => setDrugName(event.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dose">Dose</Label>
              <Input
                id="dose"
                placeholder="e.g. 10mg"
                value={dose}
                onChange={(event) => setDose(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="frequency">Frequency</Label>
              <Input
                id="frequency"
                placeholder="e.g. Twice daily"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="refill_date">Refill date (optional)</Label>
            <Input
              id="refill_date"
              type="date"
              value={refillDate}
              onChange={(event) => setRefillDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new_time">Dose times</Label>
            <div className="flex gap-2">
              <Input
                id="new_time"
                type="time"
                value={newTime}
                onChange={(event) => setNewTime(event.target.value)}
                className="w-32"
              />
              <Button type="button" variant="outline" size="sm" onClick={addTime}>
                Add time
              </Button>
            </div>
            {scheduleTimes.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {scheduleTimes.map((time) => (
                  <span
                    key={time}
                    className="inline-flex items-center gap-1 rounded-full bg-charcoal-ink/10 px-2.5 py-1 text-xs text-charcoal-ink/80"
                  >
                    {time}
                    <button
                      type="button"
                      onClick={() => removeTime(time)}
                      aria-label={`Remove ${time}`}
                      className="text-charcoal-ink/50 hover:text-charcoal-ink"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && <p className="text-sm text-brand-green">Medication added.</p>}
          <Button type="submit" disabled={addMedication.isPending}>
            {addMedication.isPending ? "Saving…" : "Add medication"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
