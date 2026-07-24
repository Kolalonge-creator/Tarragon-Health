"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  useVaccinationCatalog,
  useVaccinationRecords,
  useLogVaccination,
  useAttachVaccinationCertificate,
} from "@/lib/queries/vaccination";
import { useBookingRequests } from "@/lib/queries/facilities";
import { syncVaccinationScheduleAction } from "./vaccination-actions";
import { computeVaccinationStatuses } from "@/lib/rules/vaccination-status";
import {
  logVaccinationSchema,
  validateCertificateFile,
  CERTIFICATE_ACCEPT,
} from "@/lib/validation/vaccination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LogVaccinationForm({
  patientId,
  ageYears = null,
  dateOfBirth = null,
  sex = null,
}: {
  patientId: string;
  ageYears?: number | null;
  dateOfBirth?: string | null;
  sex?: "male" | "female" | null;
}) {
  const catalog = useVaccinationCatalog();
  const records = useVaccinationRecords(patientId);
  const bookings = useBookingRequests(patientId);
  const logVaccination = useLogVaccination();
  const attachCertificate = useAttachVaccinationCertificate();

  // The catalogue is shared across every age (adult + NPHCDA child
  // schedule) — hide vaccines that aren't applicable to this subject (e.g.
  // shingles for a toddler, BCG for a 40-year-old) rather than list all of
  // them for every patient.
  const selectableCatalog = useMemo(() => {
    if (!catalog.data) return [];
    if (!records.data) return catalog.data;
    const statuses = computeVaccinationStatuses(catalog.data, records.data, {
      ageYears,
      dateOfBirth,
      sex,
    });
    const notApplicable = new Set(
      statuses.filter((s) => s.status === "not_applicable").map((s) => s.catalogId)
    );
    return catalog.data.filter((entry) => !notApplicable.has(entry.id));
  }, [catalog.data, records.data, ageYears, dateOfBirth, sex]);

  const [catalogId, setCatalogId] = useState("");
  const [doseNumber, setDoseNumber] = useState("1");
  const [dateAdministered, setDateAdministered] = useState("");
  const [provider, setProvider] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Confirmed/requested appointments at a vaccination centre — lets the
  // patient link this dose back to the appointment they booked (Priority #2).
  const vaccinationBookings = useMemo(
    () =>
      (bookings.data ?? []).filter(
        (b) =>
          b.facilities?.type === "vaccination_centre" &&
          (b.status === "requested" || b.status === "confirmed"),
      ),
    [bookings.data],
  );

  function reset() {
    setCatalogId("");
    setDoseNumber("1");
    setDateAdministered("");
    setProvider("");
    setBookingId("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);

    const parsed = logVaccinationSchema.safeParse({
      vaccination_catalog_id: catalogId,
      dose_number: doseNumber,
      date_administered: dateAdministered,
      provider: provider || undefined,
      booking_request_id: bookingId || undefined,
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    if (file) {
      const fileError = validateCertificateFile(file);
      if (fileError) {
        setValidationError(fileError);
        return;
      }
    }
    setValidationError(null);

    try {
      const recordId = await logVaccination.mutateAsync({ ...parsed.data, patientId });
      if (file) {
        await attachCertificate.mutateAsync({ recordId, patientId, file });
        setSuccess("Vaccination logged and certificate sent to your care team for verification.");
      } else {
        setSuccess("Vaccination logged.");
      }
      reset();
      // Roll the persisted schedule (and its reminder) forward now the dose is
      // on file — fire-and-forget, never blocks the UI.
      void syncVaccinationScheduleAction();
    } catch {
      // Mutation errors surface via the hooks below.
    }
  }

  const mutationError =
    (logVaccination.error as Error | null)?.message ??
    (attachCertificate.error as Error | null)?.message ??
    null;
  const displayError = validationError ?? mutationError;
  const isPending = logVaccination.isPending || attachCertificate.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a vaccination</CardTitle>
        <CardDescription>
          Record a dose you&apos;ve received. If you were given a certificate at the centre, add a
          photo of it — your Tarragon care team will verify it and issue your Tarragon certificate.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vaccination_catalog_id">Vaccine</Label>
            <Select
              id="vaccination_catalog_id"
              value={catalogId}
              onChange={(event) => setCatalogId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select
              </option>
              {selectableCatalog.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="dose_number">Dose number</Label>
              <Input
                id="dose_number"
                type="number"
                min={1}
                max={20}
                value={doseNumber}
                onChange={(event) => setDoseNumber(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date_administered">Date given</Label>
              <Input
                id="date_administered"
                type="date"
                value={dateAdministered}
                onChange={(event) => setDateAdministered(event.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider (optional)</Label>
            <Input
              id="provider"
              placeholder="e.g. clinic or pharmacy name"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </div>
          {vaccinationBookings.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="booking_request_id">From which appointment? (optional)</Label>
              <Select
                id="booking_request_id"
                value={bookingId}
                onChange={(event) => setBookingId(event.target.value)}
              >
                <option value="">Not linked to a booking</option>
                {vaccinationBookings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.facilities?.name ?? "Vaccination centre"} ·{" "}
                    {new Date(b.requested_date).toLocaleDateString()}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="certificate">Certificate from the centre (optional)</Label>
            <Input
              id="certificate"
              ref={fileInputRef}
              type="file"
              accept={CERTIFICATE_ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-charcoal-ink/60">
              Add a clear photo or PDF (up to 10 MB). We&apos;ll verify it and issue your Tarragon
              certificate.
            </p>
          </div>
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && <p className="text-sm text-brand-green">{success}</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Log vaccination"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
