"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  confirmLabReportExtraction,
  discardLabReportExtraction,
  extractLabReportAction,
} from "@/lib/lab-reports/extraction-actions";
import { getQualitativeAnalyte } from "@/lib/lab-reports/analyte-catalogue";
import { interpretReading, type AnalyteStatus } from "@/lib/lab-reports/reference-ranges";
import type { ExtractedRow } from "@/lib/lab-reports/extract";

export interface ExtractionView {
  id: string;
  status: "extracted" | "failed" | "confirmed" | "discarded";
  reportDate: string | null;
  labName: string | null;
  patientNameOnReport: string | null;
  rows: ExtractedRow[];
  unreadableReason: string | null;
  errorMessage: string | null;
  confirmedAt: string | null;
  confirmedCodes: string[];
}

interface Props {
  documentId: string;
  signedUrl: string | null;
  isPdf: boolean;
  patientSex: string | null;
  /** Needed for the age-banded ranges (PSA) and for eGFR. Null is handled. */
  patientAgeYears: number | null;
  patientName: string | null;
  extraction: ExtractionView | null;
}

const STATUS_COPY: Record<ExtractedRow["status"], { label: string; tone: "amber" | "red" | "grey" }> = {
  ready: { label: "", tone: "grey" },
  unknown_unit: { label: "Unit not recognised", tone: "amber" },
  implausible: { label: "Value looks wrong", tone: "red" },
  unmapped: { label: "Not a test we store", tone: "grey" },
  unreadable_value: { label: "Result wording not recognised", tone: "amber" },
};

/**
 * How a classified result is coloured. This is a REVIEW AID on an unconfirmed
 * draft, never a finding: nothing here is recorded, and recording an abnormal
 * result stays a separate deliberate act through the screening-result form.
 */
const STATUS_TONE: Record<AnalyteStatus, string> = {
  normal: "text-charcoal-ink/45",
  borderline: "text-amber-700",
  abnormal: "text-red-700",
  critical: "text-red-700 font-semibold",
};

/**
 * Side-by-side review of a machine-read lab report.
 *
 * The document stays on screen next to the numbers, because the entire safety
 * argument for this feature is that a human checks the transcription against
 * the source. A reviewer can correct any value before filing, and what gets
 * written is THEIR number — the draft is a starting point, not an authority.
 *
 * Rows the extractor could not map, could not convert, or read as implausible
 * are shown and NOT selectable. Hiding them would quietly lose a result; making
 * them one-click filable would defeat the guard that caught them.
 */
export function LabReportExtractionPanel({
  documentId,
  signedUrl,
  isPdf,
  patientSex,
  patientAgeYears,
  patientName,
  extraction,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readyRows = (extraction?.rows ?? []).filter((r) => r.status === "ready");
  const blockedRows = (extraction?.rows ?? []).filter((r) => r.status !== "ready");

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [reportDate, setReportDate] = useState(
    extraction?.reportDate ?? new Date().toISOString().slice(0, 10),
  );

  // Seed the editable fields from the draft, and RE-seed whenever a different
  // draft arrives.
  //
  // A useState initialiser runs once, on mount. This component mounts before
  // any draft exists (the "Read this report" state), so seeding there left the
  // value boxes empty and every row unticked once the draft came back — the
  // clinician saw a review screen with nothing in it. Adjusting state during
  // render, keyed on the draft's own id, is React's documented pattern for
  // "reset state when a prop changes" and re-runs correctly on a re-read.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (extraction && extraction.id !== seededFor) {
    setSeededFor(extraction.id);
    setSelected(Object.fromEntries(readyRows.map((r) => [r.code as string, true])));
    setValues(
      Object.fromEntries(
        readyRows.map((r) => [r.code as string, String(r.valueText ?? r.value ?? "")]),
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
          Read the results off this report automatically, then check them before filing. You can
          still enter them by hand instead.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => extractLabReportAction(documentId))}
        >
          {pending ? "Reading the report…" : "Read this report"}
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
        {extraction.confirmedCodes.length} result
        {extraction.confirmedCodes.length === 1 ? "" : "s"} filed from this report
        {extraction.reportDate ? ` (collected ${formatDate(extraction.reportDate)})` : ""}.
      </p>
    );
  }

  // ------------------------------------------------------------------- failed
  if (extraction.status === "failed") {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="text-xs text-amber-900">
          {extraction.errorMessage ?? "This report could not be read automatically."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={pending}
          onClick={() => run(() => extractLabReportAction(documentId))}
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

  const selectedCount = readyRows.filter((r) => selected[r.code as string]).length;

  function submit() {
    // A qualitative result files as text with no unit; a numeric one files with
    // its canonical unit. The server re-validates both, and the database
    // constraint refuses a row carrying neither or both.
    const rows = readyRows
      .filter((r) => selected[r.code as string])
      .map((r) => {
        const code = r.code as string;
        const raw = values[code] ?? "";
        if (getQualitativeAnalyte(code)) {
          return raw.trim() ? { code, value_text: raw.trim() } : null;
        }
        if (raw.trim() === "") return null;
        const value = Number(raw);
        return Number.isFinite(value)
          ? { code, value, unit: r.canonicalUnit ?? undefined }
          : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) {
      setError("Select at least one result to file.");
      return;
    }
    run(() =>
      confirmLabReportExtraction({
        extraction_id: extraction!.id,
        report_date: reportDate,
        rows,
      }),
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/15 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink">Check before filing</p>
        <Badge variant="amber">AI-drafted, not yet filed</Badge>
      </div>

      {extraction.unreadableReason ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          {extraction.unreadableReason}
        </p>
      ) : null}

      {nameMismatch ? (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          The name on this report reads &ldquo;{extraction.patientNameOnReport}&rdquo;, which does
          not look like this patient. Confirm you are filing to the right record.
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Left: the source document, kept on screen so the check is possible. */}
        <div className="min-h-[18rem] overflow-hidden rounded border border-charcoal-ink/10 bg-charcoal-ink/[0.03]">
          {signedUrl ? (
            isPdf ? (
              <iframe src={signedUrl} title="Lab report" className="h-[28rem] w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
              <img src={signedUrl} alt="Lab report" className="max-h-[28rem] w-full object-contain" />
            )
          ) : (
            <p className="p-3 text-xs text-red-600">The report file could not be loaded.</p>
          )}
        </div>

        {/* Right: what was read, editable. */}
        <div className="space-y-2">
          <div className="text-xs text-charcoal-ink/60">
            {extraction.labName ? <span>{extraction.labName} · </span> : null}
            <label className="inline-flex items-center gap-1">
              Collected
              <input
                type="date"
                value={reportDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setReportDate(e.target.value)}
                className="rounded border border-charcoal-ink/20 px-1 py-0.5 text-xs"
              />
            </label>
          </div>

          {readyRows.length === 0 ? (
            <p className="text-xs text-charcoal-ink/60">
              Nothing on this report could be read into a storable result.
            </p>
          ) : (
            <ul className="space-y-1">
              {readyRows.map((row) => {
                const code = row.code as string;
                const qualitative = getQualitativeAnalyte(code);
                const raw = values[code] ?? "";
                // Number("") is 0, and 0 reads as critically low for almost
                // every analyte. An empty box means "no value yet", never zero.
                const hasValue = raw.trim() !== "";
                const numeric = hasValue ? Number(raw) : Number.NaN;

                // Classify what is ON SCREEN, not what the model first read, so
                // a reviewer correcting a value sees the colour follow their
                // correction rather than the draft it replaced.
                const interpretation = qualitative
                  ? hasValue
                    ? interpretReading(code, raw, {
                        sex: patientSex === "male" || patientSex === "female" ? patientSex : null,
                        ageYears: patientAgeYears,
                      })
                    : null
                  : Number.isFinite(numeric)
                    ? interpretReading(code, numeric, {
                        sex: patientSex === "male" || patientSex === "female" ? patientSex : null,
                        ageYears: patientAgeYears,
                      })
                    : null;

                return (
                  <li
                    key={code}
                    className="rounded border border-charcoal-ink/10 px-2 py-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(selected[code])}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [code]: e.target.checked }))
                        }
                        aria-label={`File ${row.label}`}
                      />
                      <span className="min-w-[7rem] flex-1 text-xs font-medium text-charcoal-ink">
                        {row.label}
                      </span>

                      {qualitative ? (
                        <select
                          value={raw}
                          onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                          className="rounded border border-charcoal-ink/20 px-1 py-0.5 text-xs"
                          aria-label={`${row.label} result`}
                        >
                          {/* The read value first, so an unrecognised wording is
                              still visible rather than silently replaced. */}
                          {raw && !qualitative.values.includes(raw) ? (
                            <option value={raw}>{raw}</option>
                          ) : null}
                          {qualitative.values.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <>
                          <input
                            type="number"
                            step="any"
                            value={raw}
                            onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                            className="w-20 rounded border border-charcoal-ink/20 px-1 py-0.5 text-right text-xs"
                            aria-label={`${row.label} value`}
                          />
                          <span className="w-14 text-xs text-charcoal-ink/60">
                            {row.canonicalUnit}
                          </span>
                        </>
                      )}

                      {interpretation && interpretation.status !== "normal" ? (
                        <span className={`text-[0.65rem] ${STATUS_TONE[interpretation.status]}`}>
                          {interpretation.status}
                          {interpretation.direction ? ` (${interpretation.direction})` : ""}
                        </span>
                      ) : null}
                      {row.converted ? (
                        <span
                          className="text-[0.65rem] text-charcoal-ink/50"
                          title={`Report printed ${row.value} ${row.unit ?? ""}`}
                        >
                          converted
                        </span>
                      ) : null}
                    </div>

                    {/* Quality-control findings. These are deterministic checks
                        over the reading, not the model grading itself, and they
                        are the reason to look twice at a specific row. */}
                    {row.flags?.length ? (
                      <ul className="mt-1 space-y-0.5 pl-6">
                        {row.flags.map((flag) => (
                          <li key={flag.key} className="text-[0.65rem] text-amber-700">
                            {flag.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {interpretation?.note ? (
                      <p className="mt-1 pl-6 text-[0.65rem] text-charcoal-ink/50">
                        {interpretation.note}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {blockedRows.length > 0 ? (
            <details className="text-xs text-charcoal-ink/60">
              <summary className="cursor-pointer">
                {blockedRows.length} row{blockedRows.length === 1 ? "" : "s"} could not be filed
                automatically
              </summary>
              <ul className="mt-1 space-y-0.5">
                {blockedRows.map((row, i) => (
                  <li key={`${row.reportedLabel}-${i}`}>
                    {row.reportedLabel}: {row.valueText ?? row.value ?? "—"}{" "}
                    {row.unit ?? ""} ({STATUS_COPY[row.status].label})
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
          {pending
            ? "Filing…"
            : `File ${selectedCount} result${selectedCount === 1 ? "" : "s"}`}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => discardLabReportExtraction(extraction!.id))}
        >
          Discard draft
        </Button>
      </div>
      <p className="text-[0.65rem] text-charcoal-ink/50">
        Filing records these numbers on the patient&rsquo;s record. It does not record a finding.
        Use the screening result form for that.
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
 * Loose name comparison for the wrong-patient warning. Deliberately forgiving —
 * reports print names in any order, with initials, titles and extra given
 * names — because a false alarm on every upload would train reviewers to
 * dismiss the one that matters.
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
