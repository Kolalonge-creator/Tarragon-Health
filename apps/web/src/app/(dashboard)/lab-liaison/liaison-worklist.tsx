"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { uploadResultDocumentForPatient } from "@/lib/lab-results/actions";
import {
  RESULT_DOC_ACCEPT,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export interface LiaisonPatient {
  id: string;
  fullName: string | null;
  patientNumber: string | null;
  phone: string | null;
}

export interface RecentUpload {
  id: string;
  patientName: string | null;
  source: string;
  originalFilename: string | null;
  note: string | null;
  createdAt: string;
  reviewed: boolean;
}

const SOURCE_LABEL: Record<string, string> = {
  patient: "Patient",
  lab_liaison: "Lab liaison",
  clinician: "Clinician",
  admin: "Admin",
};

function UploadPanel({ patients }: { patients: LiaisonPatient[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients.slice(0, 25);
    return patients
      .filter(
        (p) =>
          (p.fullName ?? "").toLowerCase().includes(q) ||
          (p.patientNumber ?? "").toLowerCase().includes(q) ||
          (p.phone ?? "").includes(q),
      )
      .slice(0, 25);
  }, [patients, query]);

  const selected = patients.find((p) => p.id === patientId) ?? null;

  const upload = useMutation({
    mutationFn: async () => {
      if (!patientId) throw new Error("Choose a patient first.");
      if (!file) throw new Error("Attach the result file.");
      const formData = new FormData();
      formData.set("file", file);
      formData.set("patient_id", patientId);
      if (note.trim()) formData.set("note", note.trim());
      const result = await uploadResultDocumentForPatient(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setSuccess("Result uploaded — the patient can see it and it's flagged for a clinician.");
      setFile(null);
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (file) {
      const fileError = validateResultDocFile(file);
      if (fileError) {
        setValidationError(fileError);
        return;
      }
    }
    upload.mutate();
  }

  const displayError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a lab result</CardTitle>
        <CardDescription>
          Find the patient, then upload the result the lab emailed you (PDF or image). The patient
          sees it on their portal and a clinician is prompted to review it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="patient-search">Patient</Label>
            <Input
              id="patient-search"
              placeholder="Search by name, patient number, or phone"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPatientId(null);
              }}
              autoComplete="off"
            />
            {selected ? (
              <p className="text-sm text-brand-green">
                Selected: <span className="font-medium">{selected.fullName ?? "Unnamed"}</span>
                {selected.patientNumber ? ` · ${selected.patientNumber}` : ""}
              </p>
            ) : (
              <ul className="max-h-48 divide-y divide-charcoal-ink/10 overflow-y-auto rounded-md border border-charcoal-ink/10">
                {filtered.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-charcoal-ink/50">No matching patients.</li>
                ) : (
                  filtered.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPatientId(p.id)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-brand-green/5"
                      >
                        <span className="font-medium text-charcoal-ink">
                          {p.fullName ?? "Unnamed patient"}
                        </span>
                        {p.patientNumber && (
                          <span className="text-charcoal-ink/60"> · {p.patientNumber}</span>
                        )}
                        {p.phone && <span className="text-charcoal-ink/50"> · {p.phone}</span>}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="result-file">Result file</Label>
            <Input
              id="result-file"
              ref={fileInputRef}
              type="file"
              accept={RESULT_DOC_ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-charcoal-ink/60">PDF or photo, up to 10 MB.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="result-note">Note (optional)</Label>
            <Textarea
              id="result-note"
              placeholder="e.g. Synlab · FBC · received 20 Jul"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </div>

          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && <p className="text-sm text-brand-green">{success}</p>}

          <Button type="submit" disabled={upload.isPending || !patientId || !file}>
            {upload.isPending ? "Uploading…" : "Upload result"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RecentUploads({ recent }: { recent: RecentUpload[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recently uploaded</CardTitle>
        <CardDescription>The latest results uploaded across your organisation.</CardDescription>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No results uploaded yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {recent.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">
                    {doc.patientName ?? "Unknown patient"}
                  </p>
                  <p className="truncate text-xs text-charcoal-ink/60">
                    {doc.originalFilename ?? "result"} · {SOURCE_LABEL[doc.source] ?? doc.source} ·{" "}
                    {new Date(doc.createdAt).toLocaleDateString()}
                    {doc.note ? ` · ${doc.note}` : ""}
                  </p>
                </div>
                <Badge variant={doc.reviewed ? "green" : "amber"}>
                  {doc.reviewed ? "Reviewed" : "Awaiting review"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function LabLiaisonWorklist({
  patients,
  recent,
}: {
  patients: LiaisonPatient[];
  recent: RecentUpload[];
}) {
  return (
    <div className="space-y-6">
      <UploadPanel patients={patients} />
      <RecentUploads recent={recent} />
    </div>
  );
}
