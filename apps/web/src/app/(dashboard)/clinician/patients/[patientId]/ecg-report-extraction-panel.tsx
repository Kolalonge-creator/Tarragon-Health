"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  confirmEcgReportExtraction,
  discardEcgReportExtraction,
  extractEcgReportAction,
} from "@/lib/ecg-reports/extraction-actions";
import { getEcgParameter } from "@/lib/ecg-reports/ecg-parameter-catalogue";
import { looksTwelveLeadFlags, type ExtractedParameter } from "@/lib/ecg-reports/extract";

export interface EcgExtractionView {
  id: string;
  status: "extracted" | "failed" | "confirmed" | "discarded";
  reportDate: string | null;
  facilityName: string | null;
  patientNameOnReport: string | null;
  looksTwelveLead: boolean;
  parameters: ExtractedParameter[];
  unreadableReason: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  confirmedCodes: string[];
}

interface Props {
  documentId: string;
  signedUrl: string | null;
  isPdf: boolean;
  patientName: string | null;
  extraction: EcgExtractionView | null;
}

const STATUS_COPY: Record<ExtractedParameter["status"], string> = {
  ready: "",
  unknown_unit: "Unit not recognised",
  implausible: "Value looks wrong",
  unmapped: "Not a parameter we store",
};

/**
 * Side-by-side review of a machine-read 12-lead ECG parameter block.
 *
 * DELIBERATELY NO CLINICAL CLASSIFICATION HERE — unlike the lab report panel,
 * there is no "normal/borderline/abnormal" colouring on any value. This panel
 * transcribes; it never judges. The clinician's own read of the tracing is
 * recorded separately via the existing procedural_status field on the
 * screening result — see the note at the bottom of this panel.
 *
 * The document stays on screen next to the numbers for the same reason as
 * the lab panel: the safety argument for this feature is that a human checks
 * the transcription against the source before anything is filed.
 */
export function EcgReportExtractionPanel({
  documentId,
  signedUrl,
  isPdf,
  patientName,
  extraction,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readyParams = (extraction?.parameters ?? []).filter((p) => p.status === "ready");
  const blockedParams = (extraction?.parameters ?? []).filter((p) => p.status !== "ready");

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [reportDate, setReportDate] = useState(
    extraction?.reportDate ?? new Date().toISOString().slice(0, 10),
  );

  // Seed the editable fields from the draft, and RE-seed whenever a different
  // draft arrives — same pattern as LabReportExtractionPanel, see its own
  // comment for why this runs during render rather than in a useState
  // initialiser.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (extraction && extraction.id !== seededFor) {
    setSeededFor(extraction.id);
    setSelected(Object.fromEntries(readyParams.map((p) => [p.code as string, true])));
    setValues(
      Object.fromEntries(
        readyParams.map((p) => [p.code as string, String(p.valueText ?? p.value ?? "")]),
      ),
    );
    if (extraction.reportDate) setReportDate(extraction.reportDate);
  }

  function run(action: () => Promise<{ error?: string; message?: string }>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      if (result.message) setMessage(result.message);
    });
  }

  // ---------------------------------------------------------------- no draft
  if (!extraction || extraction.status === "discarded") {
    return (
      <div className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
        <p className="text-xs text-charcoal-ink/70">
          Read the printed parameters (rate, intervals, axis) off this ECG automatically, then
          check them before filing. You can still enter them by hand instead.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => extractEcgReportAction(documentId))}
        >
          {pending ? "Reading the ECG…" : "Read this ECG"}
        </Button>
        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        {message ? <p className="mt-2 text-xs text-charcoal-ink/70">{message}</p> : null}
      </div>
    );
  }

  // ----------------------------------------------------------------- already filed
  if (extraction.status === "confirmed") {
    return (
      <p className="text-xs text-charcoal-ink/70">
        {extraction.confirmedCodes.length} parameter
        {extraction.confirmedCodes.length === 1 ? "" : "s"} filed from this ECG
        {extraction.reportDate ? ` (recorded ${formatDate(extraction.reportDate)})` : ""}.
      </p>
    );
  }

  // ------------------------------------------------------------------- failed
  if (extraction.status === "failed") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="text-xs text-amber-900">
          {extraction.errorMessage ?? "This ECG could not be read automatically."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => extractEcgReportAction(documentId))}
        >
          Try again
        </Button>
      </div>
    );
  }

  // ------------------------------------------------------------------ review
  const nameMismatch =
    extraction.patientNameOnReport &&
    patientName &&
    !looksLikeSameName(extraction.patientNameOnReport, patientName);

  const twelveLeadFlags = looksTwelveLeadFlags(extraction.looksTwelveLead);
  const selectedCount = readyParams.filter((p) => selected[p.code as string]).length;

  function submit() {
    // machine_rhythm_statement (the one text parameter) files as text with no
    // unit; every other parameter files numeric with its canonical unit. The
    // server re-validates both, and the database constraint refuses a row
    // carrying neither or both.
    const parameters = readyParams
      .filter((p) => selected[p.code as string])
      .map((p) => {
        const code = p.code as string;
        const raw = values[code] ?? "";
        const isText = getEcgParameter(code)?.canonicalUnit === null;
        if (isText) {
          return raw.trim() ? { code, value_text: raw.trim() } : null;
        }
        if (raw.trim() === "") return null;
        const value = Number(raw);
        return Number.isFinite(value) ? { code, value, unit: p.canonicalUnit ?? undefined } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (parameters.length === 0) {
      setError("Select at least one parameter to file.");
      return;
    }
    run(() =>
      confirmEcgReportExtraction({
        extraction_id: extraction!.id,
        report_date: reportDate,
        parameters,
      }),
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/15 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">Check before filing</p>
        <Badge variant="amber">AI-transcribed, not yet filed</Badge>
      </div>

      {extraction.unreadableReason ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {extraction.unreadableReason}
        </p>
      ) : null}

      {twelveLeadFlags.map((flag) => (
        <p
          key={flag.key}
          className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800"
        >
          {flag.message}
        </p>
      ))}

      {nameMismatch ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          The name on this ECG reads &ldquo;{extraction.patientNameOnReport}&rdquo;, which does not
          look like this patient. Confirm you are filing to the right record.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Left: the source tracing, kept on screen so the check is possible. */}
        <div className="min-h-[18rem] overflow-hidden rounded border border-charcoal-ink/10 bg-charcoal-ink/[0.03]">
          {signedUrl ? (
            isPdf ? (
              <iframe src={signedUrl} title="ECG tracing" className="h-[28rem] w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
              <img src={signedUrl} alt="ECG tracing" className="max-h-[28rem] w-full object-contain" />
            )
          ) : (
            <p className="p-3 text-xs text-red-600">The ECG file could not be loaded.</p>
          )}
        </div>

        {/* Right: what was read, editable. */}
        <div className="space-y-2">
          <div className="text-xs text-charcoal-ink/60">
            {extraction.facilityName ? <span>{extraction.facilityName} · </span> : null}
            <label className="inline-flex items-center gap-1">
              Recorded
              <input
                type="date"
                value={reportDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setReportDate(e.target.value)}
                className="rounded border border-charcoal-ink/20 px-1 py-0.5 text-xs"
              />
            </label>
          </div>

          {readyParams.length === 0 ? (
            <p className="text-xs text-charcoal-ink/60">
              Nothing on this ECG could be read into a storable parameter.
            </p>
          ) : (
            <ul className="space-y-1">
              {readyParams.map((param) => {
                const code = param.code as string;
                const definition = getEcgParameter(code);
                const isText = definition?.canonicalUnit === null;
                const raw = values[code] ?? "";

                return (
                  <li key={code} className="rounded border border-charcoal-ink/10 px-2 py-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[code])}
                        onChange={(e) => setSelected((s) => ({ ...s, [code]: e.target.checked }))}
                        aria-label={`File ${param.label}`}
                      />
                      <span className="min-w-[7rem] flex-1 text-xs font-medium text-charcoal-ink">
                        {param.label}
                      </span>

                      {isText ? (
                        <input
                          type="text"
                          value={raw}
                          onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                          className="w-48 rounded border border-charcoal-ink/20 px-1 py-0.5 text-xs"
                          aria-label={`${param.label} value`}
                        />
                      ) : (
                        <>
                          <input
                            type="number"
                            step="any"
                            value={raw}
                            onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                            className="w-20 rounded border border-charcoal-ink/20 px-1 py-0.5 text-right text-xs"
                            aria-label={`${param.label} value`}
                          />
                          <span className="w-10 text-xs text-charcoal-ink/60">{param.canonicalUnit}</span>
                        </>
                      )}

                      {param.converted ? (
                        <span
                          className="text-[0.65rem] text-charcoal-ink/50"
                          title={`ECG printed ${param.value} ${param.unit ?? ""}`}
                        >
                          converted
                        </span>
                      ) : null}
                    </div>

                    {isText ? (
                      <p className="mt-1 pl-6 text-[0.65rem] text-charcoal-ink/50">
                        As printed by the ECG machine — not a Tarragon or clinician assessment.
                      </p>
                    ) : null}

                    {/* Quality-control findings — deterministic checks over the
                        reading (e.g. QTc vs. the Bazett formula), never the
                        model grading itself. */}
                    {param.flags?.length ? (
                      <ul className="mt-1 space-y-0.5 pl-6">
                        {param.flags.map((flag, i) => (
                          <li key={`${flag.key}-${i}`} className="text-[0.65rem] text-amber-700">
                            {flag.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {blockedParams.length > 0 ? (
            <details className="text-xs text-charcoal-ink/60">
              <summary className="cursor-pointer">
                {blockedParams.length} field{blockedParams.length === 1 ? "" : "s"} could not be
                filed automatically
              </summary>
              <ul className="mt-1 space-y-0.5">
                {blockedParams.map((param, i) => (
                  <li key={`${param.reportedLabel}-${i}`}>
                    {param.reportedLabel}: {param.valueText ?? param.value ?? "—"}{" "}
                    {param.unit ?? ""} — {STATUS_COPY[param.status]}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Enter any of these by hand if they are needed.</p>
            </details>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {message ? <p className="text-xs text-brand-green">{message}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || selectedCount === 0} onClick={submit}>
          {pending ? "Filing…" : `File ${selectedCount} parameter${selectedCount === 1 ? "" : "s"}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => discardEcgReportExtraction(extraction!.id))}
        >
          Discard draft
        </Button>
      </div>
      <p className="text-[0.65rem] text-charcoal-ink/50">
        Filing records these numbers on the patient&rsquo;s record. It is not a clinical reading of
        the ECG — record your own assessment separately below, in the result field for this screen.
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Loose name comparison for the wrong-patient warning — same forgiving logic
 * as LabReportExtractionPanel's own helper (duplicated rather than shared,
 * matching this codebase's existing per-feature-gate convention).
 */
function looksLikeSameName(a: string, b: string): boolean {
  const tokens = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/\b(mr|mrs|miss|ms|dr|master)\b/g, "")
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return true;
  for (const token of ta) if (tb.has(token)) return true;
  return false;
}
