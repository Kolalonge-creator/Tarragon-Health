"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FilePicker } from "@/components/ui/file-picker";
import { LAB_RESULT_FILE_ACCEPT } from "@/lib/lab-results/structured";
import { STAFF_STATUS_LABEL, STATUS_TONE, type ClinicalDocumentStatus } from "@/lib/clinical-documents/status";
import { findPatientForUpload, uploadLabReportForPatient, type UploadPatientMatch, type UploadState } from "./actions";

export type LabOption = { id: string; name: string; assigned: boolean };
export type MyUpload = {
  id: string;
  status: ClinicalDocumentStatus;
  uploadedAt: string;
  investigationDate: string | null;
  lab: string;
  patientName: string;
};

const OTHER_LAB = "__other__";

function formatLagosDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * Find the patient (patient number, phone, email, or name with date of birth), confirm the details printed on the report, upload.
 * The database checks the identity again and refuses a mismatch; the screen only explains it.
 */
export function LabReportUpload({ labs, uploads }: { labs: LabOption[]; uploads: MyUpload[] }) {
  const [query, setQuery] = useState("");
  const [dob, setDob] = useState("");
  const [results, setResults] = useState<UploadPatientMatch[] | null>(null);
  const [selected, setSelected] = useState<UploadPatientMatch | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [lab, setLab] = useState<string>("");
  const [state, formAction, pending] = useActionState<UploadState, FormData>(uploadLabReportForPatient, undefined);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    setSelected(null);
    const r = await findPatientForUpload({ query, ...(dob ? { dateOfBirth: dob } : {}) });
    setSearching(false);
    if ("error" in r) {
      setSearchError(r.error);
      setResults(null);
    } else {
      setResults(r.patients);
    }
  }

  const sortedLabs = [...labs].sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload a lab report for a patient</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Use this when a laboratory sends a patient&apos;s report to Tarragon instead of to the patient. Search by patient number,
            phone number or email. To search by name, add the date of birth: a name alone can match the wrong person.
          </p>
          <form onSubmit={search} className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="upload-search">Patient number, phone, email or name</Label>
              <Input id="upload-search" value={query} onChange={(e) => setQuery(e.target.value)} className="w-72" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="upload-search-dob">Date of birth (needed for a name)</Label>
              <Input id="upload-search-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="w-48" />
            </div>
            <Button type="submit" disabled={searching || query.trim().length < 3}>
              {searching ? "Searching" : "Find patient"}
            </Button>
          </form>
          {searchError ? <p className="text-sm text-red-700 dark:text-red-300">{searchError}</p> : null}
          {results && results.length === 0 ? <p className="text-sm">No patient matches that. Check the details on the report.</p> : null}
          {results && results.length > 0 ? (
            <ul className="divide-y divide-charcoal-ink/10 rounded-md border border-charcoal-ink/10">
              {results.map((p) => (
                <li key={p.patientId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span>
                    <span className="font-medium">{p.fullName}</span>
                    {" · "}
                    {p.patientNumber ?? "no patient number"}
                    {" · born "}
                    {p.birthYear ?? "unknown"}
                    {p.sex ? ` · ${p.sex}` : ""}
                    {p.state ? ` · ${p.state}` : ""}
                    {p.phoneLast4 ? ` · phone ending ${p.phoneLast4}` : ""}
                  </span>
                  <Button type="button" variant={selected?.patientId === p.patientId ? "default" : "outline"} onClick={() => setSelected(p)}>
                    {selected?.patientId === p.patientId ? "Selected" : "Choose"}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      {selected ? (
        <Card>
          <CardHeader>
            <CardTitle>Report for {selected.fullName}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={formAction} className="space-y-4" key={selected.patientId}>
              <input type="hidden" name="patientId" value={selected.patientId} />
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                Copy these from the report itself, not from the search result. If they do not match this patient, the upload is refused.
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="nameOnReport">Name on the report</Label>
                  <Input id="nameOnReport" name="nameOnReport" required minLength={3} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dateOfBirthOnReport">Date of birth on the report</Label>
                  <Input id="dateOfBirthOnReport" name="dateOfBirthOnReport" type="date" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="patientNumberOnReport">Patient number on the report</Label>
                  <Input id="patientNumberOnReport" name="patientNumberOnReport" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="labProviderId">Laboratory</Label>
                  <select
                    id="labProviderId"
                    name={lab === OTHER_LAB ? undefined : "labProviderId"}
                    value={lab}
                    onChange={(e) => setLab(e.target.value)}
                    required
                    className="h-9 w-full rounded-md border border-charcoal-ink/20 bg-transparent px-2 text-sm"
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    {sortedLabs.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.assigned ? " (yours)" : ""}
                      </option>
                    ))}
                    <option value={OTHER_LAB}>Another laboratory or centre</option>
                  </select>
                </div>
                {lab === OTHER_LAB ? (
                  <div className="space-y-1">
                    <Label htmlFor="labName">Laboratory or centre name</Label>
                    <Input id="labName" name="labName" required maxLength={200} />
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label htmlFor="investigationDate">Test date</Label>
                  <Input id="investigationDate" name="investigationDate" type="date" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="note">Note for the care team (optional, not shown to the patient)</Label>
                <Input id="note" name="note" maxLength={1000} />
              </div>
              <FilePicker
                id="file"
                name="file"
                accept={LAB_RESULT_FILE_ACCEPT}
                required
                label="Choose the report"
                hint="PDF, JPEG or PNG, up to 10 MB"
              />
              {state?.error ? <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p> : null}
              {state?.success ? (
                <p className="text-sm text-green-700 dark:text-green-300">
                  Uploaded. A doctor will review it; the patient sees it once they have.
                </p>
              ) : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Uploading" : "Upload report"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your recent uploads</CardTitle>
        </CardHeader>
        <CardContent>
          {uploads.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">Nothing uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {uploads.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{u.patientName}</span>
                    {" · "}
                    {u.lab}
                    {u.investigationDate ? ` · tested ${formatLagosDate(u.investigationDate)}` : ""}
                    {" · uploaded "}
                    {formatLagosDate(u.uploadedAt)}
                  </span>
                  <Badge variant={STATUS_TONE[u.status]}>{STAFF_STATUS_LABEL[u.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
