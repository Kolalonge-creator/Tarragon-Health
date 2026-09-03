"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useUploadVaccinationCard,
  useVaccinationCardExtractions,
  useVaccinationCatalog,
  vaccinationRecordsKey,
  vaccinationSchedulesKey,
  vaccinationCardExtractionsKey,
  type VaccinationCardExtractionRow,
} from "@/lib/queries/vaccination";
import {
  extractVaccinationCardAction,
  confirmVaccinationCardExtractionAction,
  discardVaccinationCardExtractionAction,
} from "@/lib/vaccination-cards/extraction-actions";
import type { ExtractedCardRow } from "@/lib/vaccination-cards/extract";
import { validateCertificateFile, CERTIFICATE_ACCEPT, VACCINATION_ROUTES } from "@/lib/validation/vaccination";
import { createClient } from "@/lib/supabase/client";
import { syncVaccinationScheduleAction } from "./vaccination-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const CERTIFICATE_BUCKET = "vaccination-certificates";

/** Best-effort dose number from whatever the card printed ("1st", "Dose 3",
 * "Booster") — falls back to 1 when nothing numeric is present. The reviewer
 * can always correct it before filing. */
function guessDoseNumber(hint: string | null): number {
  const match = hint?.match(/\d+/);
  return match ? Math.min(20, Math.max(1, Number(match[0]))) : 1;
}

interface EditableRow {
  key: string;
  original: ExtractedCardRow;
  include: boolean;
  vaccinationCatalogId: string;
  dateAdministered: string;
  doseNumber: string;
  provider: string;
  batchLotNumber: string;
  route: string;
  site: string;
}

/** One uploaded card/record: its read state, the review table once read, and
 * confirm/discard. Mirrors LabReportExtractionPanel's review shape, much
 * simplified — no units/ranges, and no clinical-staff gate (spec §43.12). */
function CardExtractionReview({
  extraction,
  patientId,
}: {
  extraction: VaccinationCardExtractionRow;
  patientId: string;
}) {
  const queryClient = useQueryClient();
  const catalog = useVaccinationCatalog();

  const signedUrl = useQuery({
    queryKey: ["vaccination-card-signed-url", extraction.source_path],
    queryFn: async () => {
      const supabase = createClient();
      const { data } = await supabase.storage
        .from(CERTIFICATE_BUCKET)
        .createSignedUrl(extraction.source_path, 300);
      return data?.signedUrl ?? null;
    },
    enabled: extraction.status === "extracted",
  });

  const runExtraction = useMutation({
    mutationFn: () => extractVaccinationCardAction(extraction.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaccinationCardExtractionsKey(patientId) });
    },
  });

  // Auto-trigger extraction once, right after upload — reading a card is not
  // a clinical act, so there is no reason to make the patient press a second
  // button after choosing the file.
  const triggeredRef = useRef(false);
  useEffect(() => {
    if (extraction.status === "pending" && !triggeredRef.current) {
      triggeredRef.current = true;
      runExtraction.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraction.status]);

  const rows = (extraction.rows as unknown as ExtractedCardRow[] | null) ?? [];
  const readyRows = rows.filter((r) => r.status === "ready" || r.status === "unreadable_date");
  const unmappedRows = rows.filter((r) => r.status === "unmapped");

  const [edited, setEdited] = useState<EditableRow[] | null>(null);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (extraction.status === "extracted" && seededFor !== extraction.id) {
    setSeededFor(extraction.id);
    setEdited(
      readyRows.map((row, index) => ({
        key: `${extraction.id}-${index}`,
        original: row,
        include: row.status === "ready",
        vaccinationCatalogId: row.vaccinationCatalogId ?? "",
        dateAdministered: row.dateAdministered ?? "",
        doseNumber: String(guessDoseNumber(row.doseNumberHint)),
        provider: row.provider ?? "",
        batchLotNumber: row.batchLotNumber ?? "",
        route: "",
        site: "",
      }))
    );
  }

  const discard = useMutation({
    mutationFn: () => discardVaccinationCardExtractionAction(extraction.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaccinationCardExtractionsKey(patientId) });
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      const selected = (edited ?? []).filter((r) => r.include);
      const result = await confirmVaccinationCardExtractionAction({
        extraction_id: extraction.id,
        patient_id: patientId,
        rows: selected.map((r) => ({
          vaccination_catalog_id: r.vaccinationCatalogId,
          dose_number: r.doseNumber,
          date_administered: r.dateAdministered,
          provider: r.provider || undefined,
          batch_lot_number: r.batchLotNumber || undefined,
          route: (r.route || undefined) as (typeof VACCINATION_ROUTES)[number] | undefined,
          site: r.site || undefined,
        })),
      });
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vaccinationCardExtractionsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: vaccinationRecordsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: vaccinationSchedulesKey(patientId) });
      void syncVaccinationScheduleAction();
    },
  });

  if (extraction.status === "discarded") return null;

  if (extraction.status === "confirmed") {
    const filedCount = Array.isArray(extraction.confirmed_record_ids)
      ? extraction.confirmed_record_ids.length
      : 0;
    return (
      <li className="py-3 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
        {filedCount} dose{filedCount === 1 ? "" : "s"} filed from this upload, sent to your care
        team for verification.
      </li>
    );
  }

  if (extraction.status === "pending" || runExtraction.isPending) {
    return <li className="py-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">Reading your upload…</li>;
  }

  if (extraction.status === "failed") {
    return (
      <li className="space-y-2 py-3">
        <p className="text-xs text-amber-900 dark:text-amber-300">
          {extraction.error_message ?? "This upload could not be read automatically."} Enter the
          doses by hand below, or try again.
        </p>
        <Button size="sm" variant="outline" disabled={runExtraction.isPending} onClick={() => runExtraction.mutate()}>
          Try again
        </Button>
      </li>
    );
  }

  // ------------------------------------------------------------ review
  const includedCount = (edited ?? []).filter((r) => r.include).length;

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">Check before filing</p>
        <Badge variant="amber">AI-drafted, not yet filed</Badge>
      </div>

      {extraction.unreadable_reason && (
        <p className="rounded border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/15 p-2 text-xs text-amber-900 dark:text-amber-300">
          {extraction.unreadable_reason}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="min-h-[16rem] overflow-hidden rounded border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.03] dark:bg-night-ink/10">
          {signedUrl.data ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
            <img
              src={signedUrl.data}
              alt="Uploaded vaccination card"
              className="max-h-[24rem] w-full object-contain"
            />
          ) : (
            <p className="p-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              {signedUrl.isLoading ? "Loading…" : "The uploaded file could not be shown."}
            </p>
          )}
        </div>

        <div className="space-y-2">
          {(edited ?? []).length === 0 ? (
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Nothing on this upload could be read into a storable dose.
            </p>
          ) : (
            <ul className="space-y-2">
              {(edited ?? []).map((row, index) => (
                <li key={row.key} className="rounded border border-charcoal-ink/10 dark:border-night-ink/15 p-2">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={row.include}
                      onChange={(e) =>
                        setEdited((rs) =>
                          (rs ?? []).map((r, i) => (i === index ? { ...r, include: e.target.checked } : r))
                        )
                      }
                      aria-label={`File ${row.original.reportedLabel}`}
                    />
                    <div className="flex-1 space-y-1.5">
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                        Printed: &ldquo;{row.original.reportedLabel}&rdquo;
                        {row.original.confidence === "low" ? " · unclear print, check this one" : ""}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Select
                          value={row.vaccinationCatalogId}
                          onChange={(e) =>
                            setEdited((rs) =>
                              (rs ?? []).map((r, i) =>
                                i === index ? { ...r, vaccinationCatalogId: e.target.value } : r
                              )
                            )
                          }
                          className="text-xs"
                          aria-label="Vaccine"
                        >
                          <option value="" disabled>
                            Select vaccine
                          </option>
                          {(catalog.data ?? []).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                        <Input
                          type="date"
                          value={row.dateAdministered}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) =>
                            setEdited((rs) =>
                              (rs ?? []).map((r, i) =>
                                i === index ? { ...r, dateAdministered: e.target.value } : r
                              )
                            )
                          }
                          className="text-xs"
                          aria-label="Date given"
                        />
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={row.doseNumber}
                          onChange={(e) =>
                            setEdited((rs) =>
                              (rs ?? []).map((r, i) => (i === index ? { ...r, doseNumber: e.target.value } : r))
                            )
                          }
                          className="text-xs"
                          aria-label="Dose number"
                          placeholder="Dose #"
                        />
                        <Input
                          value={row.provider}
                          onChange={(e) =>
                            setEdited((rs) =>
                              (rs ?? []).map((r, i) => (i === index ? { ...r, provider: e.target.value } : r))
                            )
                          }
                          className="text-xs"
                          placeholder="Provider (optional)"
                        />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {unmappedRows.length > 0 && (
            <details className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              <summary className="cursor-pointer">
                {unmappedRows.length} row{unmappedRows.length === 1 ? "" : "s"} could not be matched
                to a vaccine
              </summary>
              <ul className="mt-1 space-y-0.5">
                {unmappedRows.map((row, i) => (
                  <li key={`${row.reportedLabel}-${i}`}>
                    {row.reportedLabel}
                    {row.dateAdministered ? ` (${row.dateAdministered})` : ""}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Log any of these by hand using the form below.</p>
            </details>
          )}
        </div>
      </div>

      {confirm.error && <p className="text-xs text-red-600 dark:text-red-300">{(confirm.error as Error).message}</p>}
      {confirm.isSuccess && (
        <p className="text-xs text-brand-green dark:text-brand-green-bright">
          {includedCount} dose{includedCount === 1 ? "" : "s"} sent to your care team for
          verification.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={confirm.isPending || includedCount === 0}
          onClick={() => confirm.mutate()}
        >
          {confirm.isPending ? "Filing…" : `File ${includedCount} dose${includedCount === 1 ? "" : "s"}`}
        </Button>
        <Button size="sm" variant="outline" disabled={discard.isPending} onClick={() => discard.mutate()}>
          Discard upload
        </Button>
      </div>
    </li>
  );
}

/** Upload a photo/PDF of a paper vaccination card, hospital record or school
 * vaccination record; each dose it can read is drafted for review before
 * anything is filed (spec §43.12). */
export function VaccinationCardImport({ patientId }: { patientId: string }) {
  const extractions = useVaccinationCardExtractions(patientId);
  const upload = useUploadVaccinationCard();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    if (!file) {
      setFileError("Choose a photo or PDF of the card or record");
      return;
    }
    const err = validateCertificateFile(file);
    if (err) {
      setFileError(err);
      return;
    }
    setFileError(null);
    upload.mutate(
      { patientId, file },
      {
        onSuccess: () => {
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
      }
    );
  }

  const visible = useMemo(
    () => (extractions.data ?? []).filter((e) => e.status !== "discarded"),
    [extractions.data]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import from a card or record</CardTitle>
        <CardDescription>
          Have a paper vaccination card, hospital record or school record? Upload a photo or PDF
          and we&apos;ll read the doses off it for you to check before filing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept={CERTIFICATE_ACCEPT}
            className="max-w-xs text-xs"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button size="sm" disabled={upload.isPending} onClick={submit}>
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
        </div>
        {(fileError || upload.error) && (
          <p className="text-xs text-red-600 dark:text-red-300">{fileError ?? (upload.error as Error)?.message}</p>
        )}

        {visible.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {visible.map((extraction) => (
              <CardExtractionReview key={extraction.id} extraction={extraction} patientId={patientId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
