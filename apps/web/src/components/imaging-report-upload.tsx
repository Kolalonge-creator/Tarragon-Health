"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { uploadImagingReportAsPatient } from "@/lib/imaging-reports/document-actions";
import {
  IMAGING_REPORT_DOC_ACCEPT,
  validateImagingReportDocFile,
} from "@/lib/validation/imaging-report-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The patient's own "here is my imaging report" door — for the
 * self-arranged fulfilment path (they took the order to any imaging
 * facility near them, paid directly, and are uploading the result
 * themselves). Mirrors EcgReportUpload exactly. Uploading a file never
 * records a clinical finding on its own — a clinician reviews it and
 * separately files the structured imaging_reports row.
 */
export function ImagingReportUpload({
  imagingOrderId,
  label = "Upload your imaging report",
}: {
  imagingOrderId?: string;
  label?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the imaging report first.");
      const formData = new FormData();
      formData.set("file", file);
      if (imagingOrderId) formData.set("imaging_order_id", imagingOrderId);
      if (note.trim()) formData.set("note", note.trim());
      const result = await uploadImagingReportAsPatient(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setSuccess("Thank you. Your care team has been asked to review it.");
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
      const fileError = validateImagingReportDocFile(file);
      if (fileError) {
        setValidationError(fileError);
        return;
      }
    }
    upload.mutate();
  }

  const displayError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-file`} className="text-xs">
          {label}
        </Label>
        <Input
          id={`${fieldId}-file`}
          ref={fileInputRef}
          type="file"
          accept={IMAGING_REPORT_DOC_ACCEPT}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setValidationError(null);
            setSuccess(null);
          }}
        />
        <p className="text-xs text-charcoal-ink/50">
          A photo or scan of the report is fine. PDF or image, up to 20 MB.
        </p>
      </div>
      <Input
        aria-label="Anything you want your care team to know"
        placeholder="Anything you want your care team to know (optional)"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={!file || upload.isPending}>
          {upload.isPending ? "Sending…" : "Send to my care team"}
        </Button>
        {success && <p className="text-xs font-medium text-brand-green">{success}</p>}
        {displayError && <p className="text-xs text-red-600">{displayError}</p>}
      </div>
    </form>
  );
}
