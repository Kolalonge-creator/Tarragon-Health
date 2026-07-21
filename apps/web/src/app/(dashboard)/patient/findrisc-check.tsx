"use client";

import { useState } from "react";
import { scoreFindrisc, type FindriscResult, type Sex, type FamilyHistory } from "@/lib/rules/findrisc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BAND_COPY: Record<FindriscResult["band"], { label: string; tone: string }> = {
  low: { label: "Low risk", tone: "text-brand-green" },
  slightly_elevated: { label: "Slightly elevated", tone: "text-amber-700" },
  moderate: { label: "Moderate risk", tone: "text-orange-700" },
  high: { label: "High risk", tone: "text-red-700" },
  very_high: { label: "Very high risk", tone: "text-red-700" },
};

/**
 * FINDRISC diabetes-risk self-check (§5.1). Computes locally and shows the
 * band + the two-stage next step (a moderate-or-higher result → book a blood
 * test). Screening education, not a diagnosis.
 */
export function FindriscCheck() {
  const [result, setResult] = useState<FindriscResult | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    setResult(
      scoreFindrisc({
        ageYears: num("age"),
        bmi: num("bmi"),
        waistCm: num("waist"),
        sex: (f.get("sex") as Sex) ?? "male",
        physicallyActive: f.get("active") === "yes",
        eatsVegetablesFruitDaily: f.get("veg") === "yes",
        onBpMedication: f.get("bp_meds") === "yes",
        historyOfHighGlucose: f.get("high_glucose") === "yes",
        familyHistory: (f.get("family") as FamilyHistory) ?? "none",
      }),
    );
  }

  const band = result ? BAND_COPY[result.band] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diabetes risk check (FINDRISC)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fr_age">Age (years)</Label>
              <Input id="fr_age" name="age" type="number" min="18" max="120" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr_sex">Sex</Label>
              <Select id="fr_sex" name="sex" defaultValue="male">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr_bmi">BMI</Label>
              <Input id="fr_bmi" name="bmi" type="number" step="0.1" min="10" max="70" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr_waist">Waist (cm)</Label>
              <Input id="fr_waist" name="waist" type="number" step="0.5" min="40" max="200" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="fr_active">Active ≥30 min most days?</Label>
              <Select id="fr_active" name="active" defaultValue="yes">
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr_veg">Vegetables/fruit daily?</Label>
              <Select id="fr_veg" name="veg" defaultValue="yes">
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr_bp">On blood-pressure medicine?</Label>
              <Select id="fr_bp" name="bp_meds" defaultValue="no">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fr_hg">Ever told your sugar was high?</Label>
              <Select id="fr_hg" name="high_glucose" defaultValue="no">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fr_family">Family history of diabetes</Label>
            <Select id="fr_family" name="family" defaultValue="none">
              <option value="none">None</option>
              <option value="second_degree">Grandparent / aunt / uncle / cousin</option>
              <option value="first_degree">Parent / sibling / own child</option>
            </Select>
          </div>
          <Button type="submit">Check my risk</Button>
        </form>

        {result && band && (
          <div className="mt-4 space-y-1 rounded-md border border-charcoal-ink/10 p-3 text-sm">
            <p>
              Your score: <span className="font-medium">{result.score}</span> —{" "}
              <span className={`font-medium ${band.tone}`}>{band.label}</span>
            </p>
            <p className="text-charcoal-ink/60">
              Estimated 10-year chance of type 2 diabetes: {result.approxTenYearRisk}.
            </p>
            {result.recommendBloodTest ? (
              <p className="text-charcoal-ink/80">
                We&apos;d recommend a simple blood test (fasting glucose or HbA1c) to check.
                You can book one from the labs section, and your care team will guide you.
              </p>
            ) : (
              <p className="text-charcoal-ink/80">
                Keep up the healthy habits — recheck yearly, or sooner if things change.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
