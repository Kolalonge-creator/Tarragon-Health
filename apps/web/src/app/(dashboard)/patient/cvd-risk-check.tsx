"use client";

import { useState } from "react";
import { estimateCvdRiskBand, type CvdRiskBand } from "@/lib/rules/cvd-risk-afro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BAND_COPY: Record<CvdRiskBand, { label: string; tone: string }> = {
  low: { label: "Low risk", tone: "text-brand-green dark:text-brand-green-bright" },
  moderate: { label: "Moderate risk", tone: "text-amber-700 dark:text-amber-300" },
  high: { label: "High risk", tone: "text-orange-700 dark:text-orange-300" },
  very_high: { label: "Very high risk", tone: "text-red-700 dark:text-red-300" },
  insufficient: { label: "Not enough information", tone: "text-charcoal-ink/60 dark:text-night-ink/60" },
};

/**
 * Heart disease (CVD) risk self-check — the WHO/ISH AFRO-region 10-year
 * estimate (cvd-risk-afro.ts), lab-optional so it works even without a
 * cholesterol result on file. Same "compute locally, no persistence, show a
 * band" pattern as the FINDRISC diabetes check next to it. Decision support /
 * screening education only, not a diagnosis — a doctor confirms the band
 * from a real lipid panel when one exists.
 */
export function CvdRiskCheck() {
  const [result, setResult] = useState<ReturnType<typeof estimateCvdRiskBand> | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k));
    const cholRaw = f.get("cholesterol");
    setResult(
      estimateCvdRiskBand({
        age: num("age"),
        sex: (f.get("sex") as "male" | "female") ?? "male",
        smoker: f.get("smoker") === "yes",
        diabetic: f.get("diabetic") === "yes",
        systolic: num("systolic"),
        totalCholesterolMmol: cholRaw ? Number(cholRaw) : null,
      }),
    );
  }

  const band = result ? BAND_COPY[result.band] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heart disease risk check</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv_age">Age (years)</Label>
              <Input id="cv_age" name="age" type="number" min="18" max="120" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv_sex">Sex</Label>
              <Select id="cv_sex" name="sex" defaultValue="male">
                <option value="male">Male</option>
                <option value="female">Female</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv_systolic">Systolic blood pressure (mmHg)</Label>
              <Input id="cv_systolic" name="systolic" type="number" min="70" max="260" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv_chol">Total cholesterol, mmol/L (optional)</Label>
              <Input id="cv_chol" name="cholesterol" type="number" step="0.1" min="1" max="20" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cv_smoker">Do you currently smoke?</Label>
              <Select id="cv_smoker" name="smoker" defaultValue="no">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv_diabetic">Do you have diabetes?</Label>
              <Select id="cv_diabetic" name="diabetic" defaultValue="no">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </Select>
            </div>
          </div>
          <Button type="submit">Check my risk</Button>
        </form>

        {result && band && (
          <div className="mt-4 space-y-1 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3 text-sm">
            {result.band === "insufficient" ? (
              <p className={band.tone}>
                This check is for adults (18+) with a known blood pressure reading — add both to see
                your result.
              </p>
            ) : (
              <>
                <p>
                  Your estimated 10-year risk: <span className={`font-medium ${band.tone}`}>{result.label}</span>
                </p>
                {!result.labUsed && (
                  <p className="text-charcoal-ink/60 dark:text-night-ink/60">
                    Estimated without a cholesterol result. Add one from a recent lipid panel for a
                    more complete picture.
                  </p>
                )}
                <p className="text-charcoal-ink/80 dark:text-night-ink/80">
                  {result.band === "low"
                    ? "Keep up the healthy habits, recheck yearly, or sooner if things change."
                    : "We'd recommend a lipid panel and a chat with your care team to look at this more closely."}
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
