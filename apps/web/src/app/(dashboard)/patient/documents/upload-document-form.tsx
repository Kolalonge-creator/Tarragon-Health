"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { uploadPatientDocument } from "@/lib/documents/actions";
import {
  PATIENT_DOCUMENT_ACCEPT,
  validatePatientDocumentFile,
} from "@/lib/validation/patient-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const DOCUMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "laboratory_report", label: "Laboratory report" },
  { value: "imaging_report", label: "Imaging report" },
  { value: "referral_letter", label: "Referral letter" },
  { value: "consultation_note", label: "Consultation note" },
  { value: "prescription", label: "Prescription" },
  { value: "discharge_summary", label: "Discharge summary" },
  { value: "consent_form", label: "Consent form" },
  { value: "invoice", label: "Invoice" },
  { value: "insurance_document", label: "Insurance document" },
  { value: "identification_document", label: "Identification document" },
  { value: "clinical_photograph", label: "Clinical photograph" },
  { value: "other", label: "Other" },
];

/**
 * A patient adds any document to their own record — a referral letter, an
 * old prescription, an insurance card, a discharge summary, whatever they
 * want on file. Mirrors upload-result-form.tsx / avatar-upload-form.tsx's
 * shape: useRef for the file input (reset on success), local state for the
 * other fields, client-side file validation before submit, a direct
 * server-action call via useMutation (validates again, server-side, rather
 * than trusting anything computed here), then router.refresh() on success —
 * never revalidatePath from the client.
 */
export function UploadDocumentForm() {
  const router = useRouter();
  const fieldId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("other");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the document.");
      const formData = new FormData();
      formData.set("file", file);
      formData.set("document_type", documentType);
      formData.set("title", title);
      if (description) formData.set("description", description);
      if (documentDate) formData.set("document_date", documentDate);
      formData.set("confidentiality", keepPrivate ? "patient_private" : "standard");
      const result = await uploadPatientDocument(formData);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      setSuccess("Document uploaded.");
      setFile(null);
      setDocumentType("other");
      setTitle("");
      setDescription("");
      setDocumentDate("");
      setKeepPrivate(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (!file) {
      setValidationError("Attach a PDF or photo/scan of the document.");
      return;
    }
    const fileError = validatePatientDocumentFile(file);
    if (fileError) {
      setValidationError(fileError);
      return;
    }
    if (!title.trim()) {
      setValidationError("Give this document a title.");
      return;
    }
    upload.mutate();
  }

  const displayError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a document</CardTitle>
        <CardDescription>
          Referral letters, discharge summaries, old prescriptions, insurance documents — anything
          you want kept on your record.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-type`}>Document type</Label>
              <Select
                id={`${fieldId}-type`}
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
              >
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-date`}>Document date (optional)</Label>
              <Input
                id={`${fieldId}-date`}
                type="date"
                value={documentDate}
                onChange={(event) => setDocumentDate(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-title`}>Title</Label>
            <Input
              id={`${fieldId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="e.g. Cardiology referral letter"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-description`}>Description (optional)</Label>
            <Textarea
              id={`${fieldId}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-file`}>File</Label>
            <Input
              id={`${fieldId}-file`}
              ref={fileInputRef}
              type="file"
              accept={PATIENT_DOCUMENT_ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-charcoal-ink/60">PDF or photo/scan, up to 25 MB.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
            <input
              type="checkbox"
              checked={keepPrivate}
              onChange={(event) => setKeepPrivate(event.target.checked)}
              className="h-4 w-4 rounded border-charcoal-ink/30"
            />
            Keep this document private (visible only to you, not your care team)
          </label>
          {displayError && <p className="text-sm text-red-600">{displayError}</p>}
          {success && <p className="text-sm text-brand-green">{success}</p>}
          <Button type="submit" disabled={upload.isPending || !file}>
            {upload.isPending ? "Uploading…" : "Upload document"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
