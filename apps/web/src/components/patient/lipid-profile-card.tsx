"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLipidProfile } from "@/lib/queries/lipids";
import {
  LIPID_ANALYTE_META,
  computeNonHdl,
  type LipidAnalyteCode,
} from "@/lib/lipids/analytes";

/** Display order: the four measured values, then computed Non-HDL. */
const DISPLAY_ORDER: LipidAnalyteCode[] = [
  "total_cholesterol",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "non_hdl_cholesterol",
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Longitudinal lipid profile, read from the shared `lab_analyte_readings`
 * store. Presentational only — it shows values and when they were drawn, and
 * deliberately applies NO target colouring or "high/normal" judgement here:
 * lipid targets are CV-risk-dependent and live in the Medical-Director-signed
 * cv_risk_config (Phase 3), never hardcoded in a display component. Rendered
 * on the patient dashboard, the clinician patient view, and (consent-gated by
 * profile_access RLS) the family dashboard.
 */
export function LipidProfileCard({
  patientId,
  title = "Lipid profile",
  emptyMessage,
}: {
  patientId: string;
  title?: string;
  /** Override the no-data copy — used in the family view, where an empty
   * result can mean "no data" OR "this member hasn't shared it with you"
   * (RLS via profile_access), which the client can't tell apart. */
  emptyMessage?: string;
}) {
  const { data, isLoading, error } = useLipidProfile(patientId);

  const latest = data?.latest ?? {};
  // Non-HDL fallback for readings taken before it was persisted as its own row.
  const nonHdlFallback = computeNonHdl(
    latest.total_cholesterol?.value ?? null,
    latest.hdl_cholesterol?.value ?? null
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-charcoal-ink/60">Loading lipid history…</p>
        ) : error ? (
          <p className="text-sm text-charcoal-ink/60">Couldn’t load lipid results.</p>
        ) : !data?.latestDrawnAt ? (
          <p className="text-sm text-charcoal-ink/60">
            {emptyMessage ??
              "No lipid results recorded yet. A full lipid panel (Total, LDL, HDL, triglycerides) is part of the preventive screening and the hypertension and diabetes reviews."}
          </p>
        ) : (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {DISPLAY_ORDER.map((code) => {
                const meta = LIPID_ANALYTE_META[code];
                const reading = latest[code];
                const value =
                  reading?.value ??
                  (code === "non_hdl_cholesterol" ? nonHdlFallback : null);
                return (
                  <div key={code} className="rounded-md bg-mist-grey/40 p-2">
                    <dt className="text-xs text-charcoal-ink/60">
                      {meta.short}
                      {meta.computed ? " (computed)" : ""}
                    </dt>
                    <dd className="font-heading text-lg font-semibold text-charcoal-ink">
                      {value !== null && value !== undefined ? (
                        <>
                          {value}
                          <span className="ml-1 text-xs font-normal text-charcoal-ink/50">
                            {meta.unit}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-normal text-charcoal-ink/40">—</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="text-xs text-charcoal-ink/50">
              Last drawn {formatDate(data.latestDrawnAt)}. Non-HDL (Total − HDL)
              is the atherogenic-cholesterol summary your care team tracks against
              your overall cardiovascular risk.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
