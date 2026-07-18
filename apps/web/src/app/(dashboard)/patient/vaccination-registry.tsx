"use client";

import { useMemo, useRef, useState } from "react";
import {
  useVaccinationCatalog,
  useVaccinationRecords,
  useAttachVaccinationCertificate,
  type VaccinationRecord,
} from "@/lib/queries/vaccination";
import { computeVaccinationStatuses, type VaccinationStatus } from "@/lib/rules/vaccination-status";
import {
  validateCertificateFile,
  CERTIFICATE_ACCEPT,
} from "@/lib/validation/vaccination";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";

const STATUS_BADGE: Record<VaccinationStatus, { variant: BadgeProps["variant"]; label: string }> = {
  overdue: { variant: "red", label: "Overdue" },
  due: { variant: "amber", label: "Due" },
  up_to_date: { variant: "green", label: "Up to date" },
  not_yet_due: { variant: "grey", label: "Not yet due" },
  not_applicable: { variant: "grey", label: "Not applicable" },
};

const VERIFICATION_BADGE: Record<
  VaccinationRecord["verification_status"],
  { variant: BadgeProps["variant"]; label: string }
> = {
  self_reported: { variant: "grey", label: "Self-reported" },
  pending_verification: { variant: "amber", label: "Pending Tarragon verification" },
  verified: { variant: "green", label: "Tarragon-verified" },
  rejected: { variant: "red", label: "Not verified" },
};

/** One logged dose: its verification state, the Tarragon certificate (once
 * verified), and the "upload your certificate" action while unverified. */
function VaccinationRecordRow({
  record,
  vaccineName,
  patientId,
}: {
  record: VaccinationRecord;
  vaccineName: string;
  patientId: string;
}) {
  const attach = useAttachVaccinationCertificate();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const badge = VERIFICATION_BADGE[record.verification_status];
  // A patient can attach (or re-attach) proof while the dose is not yet
  // verified — self-reported, rejected, or a pending upload they want to redo.
  const canUpload = record.verification_status !== "verified";

  function submit() {
    if (!file) {
      setFileError("Choose a photo or PDF of your certificate");
      return;
    }
    const err = validateCertificateFile(file);
    if (err) {
      setFileError(err);
      return;
    }
    setFileError(null);
    attach.mutate(
      { recordId: record.id, patientId, file },
      {
        onSuccess: () => {
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
      },
    );
  }

  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {vaccineName} · dose {record.dose_number}
        </p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        Given {new Date(record.date_administered).toLocaleDateString()}
        {record.provider ? ` · ${record.provider}` : ""}
      </p>

      {record.verification_status === "verified" && (
        <div className="text-xs text-charcoal-ink/70">
          <p>
            Verified by your Tarragon care team
            {record.verified_at
              ? ` · ${new Date(record.verified_at).toLocaleDateString()}`
              : ""}
            {record.tarragon_certificate_serial
              ? ` · ${record.tarragon_certificate_serial}`
              : ""}
          </p>
          <a
            href={`/api/patient/vaccination/${record.id}/certificate`}
            className="mt-1 inline-block font-medium text-brand-green hover:underline"
          >
            Download Tarragon certificate →
          </a>
        </div>
      )}

      {record.verification_status === "pending_verification" && (
        <p className="text-xs text-charcoal-ink/60">
          Your care team is reviewing the certificate you uploaded.
        </p>
      )}

      {record.verification_status === "rejected" && record.verification_note && (
        <p className="text-xs text-red-600">
          Care team note: {record.verification_note}
        </p>
      )}

      {canUpload && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Input
            ref={fileInputRef}
            type="file"
            accept={CERTIFICATE_ACCEPT}
            className="max-w-xs text-xs"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <Button size="sm" variant="outline" disabled={attach.isPending} onClick={submit}>
            {attach.isPending
              ? "Uploading…"
              : record.verification_status === "self_reported"
                ? "Upload certificate to verify"
                : "Re-upload certificate"}
          </Button>
        </div>
      )}
      {(fileError || attach.error) && (
        <p className="text-xs text-red-600">
          {fileError ?? (attach.error as Error)?.message}
        </p>
      )}
    </li>
  );
}

export function VaccinationRegistry({
  patientId,
  ageYears,
}: {
  patientId: string;
  ageYears: number | null;
}) {
  const catalog = useVaccinationCatalog();
  const records = useVaccinationRecords(patientId);

  const catalogById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalog.data ?? []) map.set(entry.id, entry.name);
    return map;
  }, [catalog.data]);

  const statuses = useMemo(() => {
    if (!catalog.data || !records.data) return [];
    return computeVaccinationStatuses(catalog.data, records.data, { ageYears });
  }, [catalog.data, records.data, ageYears]);

  // Newest doses first for the certificate/verification list.
  const sortedRecords = useMemo(
    () =>
      [...(records.data ?? [])].sort((a, b) =>
        b.date_administered.localeCompare(a.date_administered),
      ),
    [records.data],
  );

  // Visible "what's next" prompt (Priority #4) — vaccines due or overdue now.
  const dueNext = useMemo(
    () => statuses.filter((s) => s.status === "due" || s.status === "overdue"),
    [statuses],
  );

  const isLoading = catalog.isLoading || records.isLoading;
  const isError = catalog.isError || records.isError;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Vaccination registry
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load your vaccination registry.</p>
        )}

        {!isLoading && !isError && dueNext.length > 0 && (
          <div className="rounded-lg bg-brand-green/5 p-3">
            <p className="text-sm font-medium text-deep-forest">Coming up</p>
            <ul className="mt-1 space-y-0.5">
              {dueNext.map((entry) => (
                <li key={entry.catalogId} className="text-xs text-charcoal-ink/80">
                  <span className="font-medium">{entry.name}</span>
                  {entry.dosesGiven > 0 ? ` · dose ${entry.dosesGiven + 1}` : ""}
                  {entry.nextDueDate
                    ? ` — due ${new Date(entry.nextDueDate).toLocaleDateString()}`
                    : " — due now"}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-charcoal-ink/60">
              Book at a centre below, or log the dose once you&apos;ve had it.
            </p>
          </div>
        )}

        {!isLoading && !isError && statuses.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No vaccinations in the catalogue yet.</p>
        )}

        {statuses.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Schedule
            </p>
            <ul className="divide-y divide-charcoal-ink/10">
              {statuses.map((entry) => {
                const badge = STATUS_BADGE[entry.status];
                return (
                  <li key={entry.catalogId} className="space-y-1 py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-charcoal-ink">{entry.name}</p>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-xs text-charcoal-ink/60">
                      {entry.lastDoseDate
                        ? `Last dose ${new Date(entry.lastDoseDate).toLocaleDateString()} (dose ${entry.dosesGiven})`
                        : "No doses recorded yet"}
                      {entry.nextDueDate &&
                        ` — next due ${new Date(entry.nextDueDate).toLocaleDateString()}`}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {sortedRecords.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
              Certificates
            </p>
            <ul className="divide-y divide-charcoal-ink/10">
              {sortedRecords.map((record) => (
                <VaccinationRecordRow
                  key={record.id}
                  record={record}
                  vaccineName={catalogById.get(record.vaccination_catalog_id) ?? "Vaccine"}
                  patientId={patientId}
                />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
