"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useVaccinationCatalog,
  useVaccinationRecords,
  useVaccinationNonAdministrations,
  useAttachVaccinationCertificate,
  useReportVaccinationAdverseEvent,
  vaccinationNonAdministrationsKey,
  vaccinationSchedulesKey,
  type VaccinationRecord,
} from "@/lib/queries/vaccination";
import {
  applyNonAdministrationOverrides,
  computeVaccinationStatuses,
  type VaccinationStatus,
} from "@/lib/rules/vaccination-status";
import {
  validateCertificateFile,
  CERTIFICATE_ACCEPT,
  VACCINATION_ADVERSE_EVENT_SYMPTOMS,
  VACCINATION_ADVERSE_EVENT_SEVERITIES,
} from "@/lib/validation/vaccination";
import { declineVaccinationAction } from "./vaccination-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SEMANTIC_ICON } from "@/lib/icons";

import { formatPatientDate } from "@/lib/format-date";
const STATUS_BADGE: Record<VaccinationStatus, { variant: BadgeProps["variant"]; label: string }> = {
  overdue: { variant: "red", label: "Overdue" },
  due: { variant: "amber", label: "Due" },
  up_to_date: { variant: "green", label: "Up to date" },
  not_yet_due: { variant: "grey", label: "Not yet due" },
  not_applicable: { variant: "grey", label: "Not applicable" },
  declined: { variant: "grey", label: "Declined" },
  contraindicated: { variant: "red", label: "Contraindicated" },
};

const SYMPTOM_LABEL: Record<(typeof VACCINATION_ADVERSE_EVENT_SYMPTOMS)[number], string> = {
  pain_at_site: "Pain at injection site",
  swelling_at_site: "Swelling at injection site",
  redness_at_site: "Redness at injection site",
  fever: "Fever",
  allergic_reaction: "Allergic reaction",
  fatigue: "Fatigue",
  headache: "Headache",
  nausea: "Nausea",
  other: "Other",
};

/** Report a reaction against one logged dose (spec §43.11). Collapsed behind
 * a toggle so every dose row doesn't default to an open form. */
function ReportAdverseEventControl({ record, patientId }: { record: VaccinationRecord; patientId: string }) {
  const [open, setOpen] = useState(false);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState<string>("mild");
  const [description, setDescription] = useState("");
  const report = useReportVaccinationAdverseEvent();

  function toggleSymptom(symptom: string) {
    setSymptoms((current) =>
      current.includes(symptom) ? current.filter((s) => s !== symptom) : [...current, symptom]
    );
  }

  function submit() {
    if (symptoms.length === 0) return;
    report.mutate(
      {
        vaccinationRecordId: record.id,
        patientId,
        symptoms: symptoms as (typeof VACCINATION_ADVERSE_EVENT_SYMPTOMS)[number][],
        severity: severity as (typeof VACCINATION_ADVERSE_EVENT_SEVERITIES)[number],
        description: description.trim() || undefined,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setSymptoms([]);
          setSeverity("mild");
          setDescription("");
        },
      }
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Report a reaction
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <p className="text-xs font-medium text-charcoal-ink dark:text-night-ink">
        What did you notice after this dose?
      </p>
      <div className="flex flex-wrap gap-2">
        {VACCINATION_ADVERSE_EVENT_SYMPTOMS.map((symptom) => (
          <button
            key={symptom}
            type="button"
            onClick={() => toggleSymptom(symptom)}
            className={`rounded-full border px-2.5 py-1 text-xs ${
              symptoms.includes(symptom)
                ? "border-brand-green dark:border-brand-green-bright bg-brand-green/10 dark:bg-brand-green/20 text-deep-forest dark:text-brand-green-bright"
                : "border-charcoal-ink/15 dark:border-night-ink/20 text-charcoal-ink/70 dark:text-night-ink/70"
            }`}
          >
            {SYMPTOM_LABEL[symptom]}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`severity-${record.id}`} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          How severe?
        </label>
        <Select
          id={`severity-${record.id}`}
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          className="max-w-[10rem] text-xs"
        >
          {VACCINATION_ADVERSE_EVENT_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </Select>
      </div>
      <Input
        placeholder="Anything else to add? (optional)"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        className="text-xs"
      />
      {symptoms.length === 0 && (
        <p className="text-xs text-red-600 dark:text-red-300">Choose at least one symptom</p>
      )}
      {report.error && (
        <p className="text-xs text-red-600 dark:text-red-300">{(report.error as Error).message}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={report.isPending} onClick={submit}>
          {report.isPending ? "Sending…" : "Send report"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Records an informed decline against a due/overdue/not-yet-due vaccine
 * (spec §43.3). Collapsed behind a toggle, same shape as the adverse-event
 * report control above. */
function DeclineVaccineControl({
  patientId,
  vaccinationCatalogId,
}: {
  patientId: string;
  vaccinationCatalogId: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();
  const decline = useMutation({
    mutationFn: async () => {
      const result = await declineVaccinationAction({ patientId, vaccinationCatalogId, note: note.trim() || undefined });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: vaccinationNonAdministrationsKey(patientId) });
      queryClient.invalidateQueries({ queryKey: vaccinationSchedulesKey(patientId) });
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Decline
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
      <p className="text-xs font-medium text-charcoal-ink dark:text-night-ink">
        Decline this vaccine? Your care team will see this instead of a repeating reminder.
      </p>
      <Input
        placeholder="Reason (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        className="text-xs"
      />
      {decline.error && (
        <p className="text-xs text-red-600 dark:text-red-300">{(decline.error as Error).message}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={decline.isPending} onClick={() => decline.mutate()}>
          {decline.isPending ? "Saving…" : "Confirm decline"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

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
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {vaccineName} · dose {record.dose_number}
        </p>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
        Given {formatPatientDate(record.date_administered)}
        {record.provider ? ` · ${record.provider}` : ""}
        {record.location ? ` · ${record.location}` : ""}
      </p>
      {(record.batch_lot_number || record.site || record.route) && (
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          {[
            record.batch_lot_number ? `Batch/lot ${record.batch_lot_number}` : null,
            record.site,
            record.route,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {record.verification_status === "verified" && (
        <div className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          <p>
            Verified by your Tarragon care team
            {record.verified_at
              ? ` · ${formatPatientDate(record.verified_at)}`
              : ""}
            {record.tarragon_certificate_serial
              ? ` · ${record.tarragon_certificate_serial}`
              : ""}
          </p>
          <a
            href={`/api/patient/vaccination/${record.id}/certificate`}
            className="mt-1 inline-block font-medium text-brand-green dark:text-brand-green-bright hover:underline"
          >
            Download Tarragon certificate →
          </a>
        </div>
      )}

      {record.verification_status === "pending_verification" && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Your care team is reviewing the certificate you uploaded.
        </p>
      )}

      {record.verification_status === "rejected" && record.verification_note && (
        <p className="text-xs text-red-600 dark:text-red-300">
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
        <p className="text-xs text-red-600 dark:text-red-300">
          {fileError ?? (attach.error as Error)?.message}
        </p>
      )}
      <div className="pt-1">
        <ReportAdverseEventControl record={record} patientId={patientId} />
      </div>
    </li>
  );
}

export function VaccinationRegistry({
  patientId,
  ageYears,
  dateOfBirth = null,
  sex = null,
}: {
  patientId: string;
  ageYears: number | null;
  /** Powers the DOB-anchored infant/child schedule (age_schedule_weeks) —
   * omit for an adult patient viewing their own card, where ageYears alone
   * is already sufficient for every existing shape. */
  dateOfBirth?: string | null;
  sex?: "male" | "female" | null;
}) {
  const catalog = useVaccinationCatalog();
  const records = useVaccinationRecords(patientId);
  const nonAdministrations = useVaccinationNonAdministrations(patientId);

  const catalogById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of catalog.data ?? []) map.set(entry.id, entry.name);
    return map;
  }, [catalog.data]);

  const statuses = useMemo(() => {
    if (!catalog.data || !records.data) return [];
    const computed = computeVaccinationStatuses(catalog.data, records.data, {
      ageYears,
      dateOfBirth,
      sex,
    });
    return applyNonAdministrationOverrides(computed, nonAdministrations.data ?? []);
  }, [catalog.data, records.data, ageYears, dateOfBirth, sex, nonAdministrations.data]);

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

  // The catalogue is shared across every age (adult + NPHCDA child schedule),
  // so "not applicable" is expected and frequent (e.g. an adult's card
  // against 11 childhood-only vaccines) — hide it from the main list rather
  // than clutter every profile with irrelevant grey badges.
  const visibleStatuses = useMemo(
    () => statuses.filter((s) => s.status !== "not_applicable"),
    [statuses],
  );

  const isLoading = catalog.isLoading || records.isLoading;
  const isError = catalog.isError || records.isError;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.preventive className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          Vaccination registry
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600 dark:text-red-300">Could not load your vaccination registry.</p>
        )}

        {!isLoading && !isError && dueNext.length > 0 && (
          <div className="rounded-lg bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm font-medium text-deep-forest dark:text-brand-green-bright">Coming up</p>
            <ul className="mt-1 space-y-0.5">
              {dueNext.map((entry) => (
                <li key={entry.catalogId} className="text-xs text-charcoal-ink/80 dark:text-night-ink/80">
                  <span className="font-medium">{entry.name}</span>
                  {entry.dosesGiven > 0 ? ` · dose ${entry.dosesGiven + 1}` : ""}
                  {entry.nextDueDate
                    ? `, due ${formatPatientDate(entry.nextDueDate)}`
                    : ", due now"}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Log the dose once you&apos;ve had it, at whichever clinic or provider is convenient.
            </p>
          </div>
        )}

        {!isLoading && !isError && visibleStatuses.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No vaccinations in the catalogue yet.</p>
        )}

        {visibleStatuses.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
              Schedule
            </p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {visibleStatuses.map((entry) => {
                const badge = STATUS_BADGE[entry.status];
                const canDecline = ["due", "overdue", "not_yet_due"].includes(entry.status);
                return (
                  <li key={entry.catalogId} className="space-y-1 py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{entry.name}</p>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      {entry.lastDoseDate
                        ? `Last dose ${formatPatientDate(entry.lastDoseDate)} (dose ${entry.dosesGiven})`
                        : "No doses recorded yet"}
                      {entry.nextDueDate &&
                        `, next due ${formatPatientDate(entry.nextDueDate)}`}
                    </p>
                    {canDecline && (
                      <div className="pt-1">
                        <DeclineVaccineControl patientId={patientId} vaccinationCatalogId={entry.catalogId} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {sortedRecords.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
              Certificates
            </p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
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
