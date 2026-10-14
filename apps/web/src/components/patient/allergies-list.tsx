"use client";

import { useState, type FormEvent } from "react";
import {
  useAllergies,
  useAddAllergy,
  usePendingAllergyRequests,
  useWithdrawAllergyRequest,
} from "@/lib/queries/allergies";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ResultExplainer } from "@/components/result-explainer";
import type { Enums } from "@tarragon/shared";

const SEVERITY_BADGE_VARIANT: Record<
  Enums<"allergy_severity">,
  NonNullable<BadgeProps["variant"]>
> = {
  mild: "grey",
  moderate: "amber",
  severe: "red",
};

const SEVERITY_LABEL: Record<Enums<"allergy_severity">, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

const SOURCE_LABEL: Record<Enums<"allergy_source">, string> = {
  patient: "You reported this",
  clinician: "Added by your care team",
  // 20260807020405_fhir_import_provenance_enums.sql -- an allergy brought in
  // from an external FHIR record import, not typed by the patient or a
  // clinician on this platform.
  fhir_import: "Imported from an external health record",
};

/**
 * Patient's allergy list (spec §76.3) -- the first place `patient_allergies`
 * is ever shown to a patient. Unlike ConditionsList, RLS lets a patient
 * insert/update/delete their own rows outright, so this card always offers
 * an inline "Add an allergy" form -- including with an empty list, the one
 * case on this summary page where self-hiding on empty would work against
 * the card's own purpose (a patient with nothing on file still needs a way
 * to add their first one).
 */
export function AllergiesList({ patientId }: { patientId: string }) {
  const { data, isLoading } = useAllergies(patientId);
  const addAllergy = useAddAllergy();
  const { data: pendingRequests } = usePendingAllergyRequests(patientId);
  const withdrawRequest = useWithdrawAllergyRequest();
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [allergen, setAllergen] = useState("");
  const [reaction, setReaction] = useState("");
  const [severity, setSeverity] = useState<Enums<"allergy_severity"> | "">("");
  const [formError, setFormError] = useState<string | null>(null);

  if (isLoading) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    try {
      await addAllergy.mutateAsync({
        patientId,
        allergen,
        reaction,
        severity,
      });
      setAllergen("");
      setReaction("");
      setSeverity("");
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save this allergy");
    }
  }

  const allergies = data ?? [];
  const pendingIdByAllergy = new Map((pendingRequests ?? []).map((request) => [request.allergy_id, request.id]));

  async function handleWithdraw(requestId: string) {
    setWithdrawError(null);
    try {
      await withdrawRequest.mutateAsync({ patientId, requestId });
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : "We could not take that request back. Please try again.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Allergies</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {allergies.length === 0 && !formOpen && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No allergies on file yet.</p>
        )}

        {allergies.map((allergy) => {
          const pendingRequestId = pendingIdByAllergy.get(allergy.id);
          return (
          <div
            key={allergy.id}
            className="space-y-1 border-b border-charcoal-ink/10 dark:border-night-ink/15 pb-3 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{allergy.allergen}</p>
              {allergy.severity && (
                <Badge variant={SEVERITY_BADGE_VARIANT[allergy.severity]}>
                  {SEVERITY_LABEL[allergy.severity]}
                </Badge>
              )}
            </div>
            {allergy.reaction && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{allergy.reaction}</p>}
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{SOURCE_LABEL[allergy.source]}</p>
            {pendingRequestId && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium text-charcoal-ink/80 dark:text-night-ink/80">
                  Change requested, waiting for your care team
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={withdrawRequest.isPending}
                  onClick={() => handleWithdraw(pendingRequestId)}
                >
                  Withdraw request
                </Button>
              </div>
            )}
            <ResultExplainer kind="allergy" subjectKey={allergy.id} label={allergy.allergen} />
          </div>
          );
        })}

        {withdrawError && (
          <p role="alert" className="text-sm text-destructive">
            {withdrawError}
          </p>
        )}

        {formOpen ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3"
          >
            <div className="space-y-1">
              <Label htmlFor="allergy-allergen">Allergen</Label>
              <Input
                id="allergy-allergen"
                value={allergen}
                onChange={(e) => setAllergen(e.target.value)}
                placeholder="e.g. Penicillin"
                maxLength={200}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="allergy-reaction">Reaction (optional)</Label>
              <Input
                id="allergy-reaction"
                value={reaction}
                onChange={(e) => setReaction(e.target.value)}
                placeholder="e.g. Rash, swelling"
                maxLength={500}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="allergy-severity">Severity (optional)</Label>
              <Select
                id="allergy-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Enums<"allergy_severity"> | "")}
              >
                <option value="">Not sure</option>
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </Select>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={addAllergy.isPending}>
                {addAllergy.isPending ? "Saving…" : "Save allergy"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setFormOpen(false);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setFormOpen(true)}>
            Add an allergy
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
