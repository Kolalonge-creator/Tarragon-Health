/**
 * Tarragon's own Good / Acceptable / Needs-attention bands for a short list of lab analytes (founder decision 2026-10-20: the
 * patient results cards show a Tarragon grade, not only the laboratory's flag). Versioned configuration: a band changes by the CMO
 * publishing a NEW version, never by editing code.
 *
 * STATUS: PROPOSED. The registry entry is `proposed`, so `activeBiomarkerBands` returns null and NO patient sees a Tarragon grade until
 * the CMO publishes a `confirmed` version. An agent never confirms it (CLAUDE.md: never sign clinical protocols as agent). Until then
 * the cards fall back to the laboratory's own flag, exactly as `/patient/biomarkers` did before.
 *
 * How a band reads: `good` and `acceptable` are inclusive ranges, `acceptable` is the wider envelope that contains `good`, and any
 * value outside `acceptable` is "needs attention". `null` is an open end. Bands apply only when the result's unit matches `unit`;
 * a result in another unit is never converted and gets no Tarragon grade (the same rule as lib/biomarkers/trend.ts).
 *
 * These are population-level adult starting points taken from public guidance (see `source`), not individual targets. A care-team
 * target set for a patient still wins on the detail view. They are deliberately separate from lib/lab-reports/analyte-catalogue.ts,
 * whose bands are orientation only and never classify anything.
 */
export type BiomarkerRange = {
  readonly min: number | null;
  readonly max: number | null;
};

export type BiomarkerBand = {
  readonly unit: string;
  readonly good: BiomarkerRange;
  readonly acceptable: BiomarkerRange;
};

export type BiomarkerBands = {
  readonly analytes: { readonly [code: string]: BiomarkerBand };
};

export const BIOMARKER_GRADE_BANDS: BiomarkerBands = {
  analytes: {
    total_cholesterol: { unit: "mmol/L", good: { min: null, max: 5.0 }, acceptable: { min: null, max: 6.4 } },
    ldl_cholesterol: { unit: "mmol/L", good: { min: null, max: 3.0 }, acceptable: { min: null, max: 4.0 } },
    hdl_cholesterol: { unit: "mmol/L", good: { min: 1.0, max: null }, acceptable: { min: 0.8, max: null } },
    triglycerides: { unit: "mmol/L", good: { min: null, max: 1.7 }, acceptable: { min: null, max: 2.3 } },
    hba1c: { unit: "mmol/mol", good: { min: null, max: 41 }, acceptable: { min: null, max: 47 } },
    fasting_glucose: { unit: "mmol/L", good: { min: 3.9, max: 5.5 }, acceptable: { min: 3.5, max: 6.9 } },
    egfr: { unit: "mL/min/1.73m2", good: { min: 90, max: null }, acceptable: { min: 60, max: null } },
  },
};
