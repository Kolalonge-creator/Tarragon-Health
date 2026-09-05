"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { uploadEcgReportAsPatient } from "@/lib/ecg-reports/actions";
import { ECG_DOC_ACCEPT, validateEcgDocFile } from "@/lib/validation/ecg-report-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The patient's own "here is my ECG" door — mirrors PatientResultUpload
 * exactly, with one deliberate difference: the copy is explicit that this is
 * a 12-lead ECG specifically, not any heart-rhythm reading. A patient has no
 * way to know a Watch or KardiaMobile-style single-lead reading won't carry
 * the parameter block (rate/PR/QRS/QT/axis) this feature reads, so telling
 * them up front is the real enforcement — the platform can't verify lead
 * count from a photo with certainty, see lib/ecg-reports/extract.ts's own
 * "looks_twelve_lead" plausibility check for the other half of this.
 *
 * Renders inline under an open ECG request, and also standalone (no
 * labOrderId) for an ECG the patient already had done before they joined.
 * Never gated by plan — same reasoning as PatientResultUpload.
 */
export function EcgReportUpload({
  labOrderId,
  label = "Upload your 12-lead ECG",
}: {
  labOrderId?: string;
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
      if (!file) throw new Error("Attach the ECG first.");
      const formData = new FormData();
      formData.set("file", file);
      if (labOrderId) formData.set("lab_order_id", labOrderId);
      if (note.trim()) formData.set("note", note.trim());
      const result = await uploadEcgReportAsPatient(formData);
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
      const fileError = validateEcgDocFile(file);
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
      <p className="rounded border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.03] dark:bg-night-ink/10 p-2 text-[0.7rem] text-charcoal-ink/70 dark:text-night-ink/70">
        Only a 12-lead ECG, the kind done at a hospital or lab, showing 12 strips labelled I, II,
        III, aVR, aVL, aVF, V1&ndash;V6. Not a Watch or single-lead strip.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-file`} className="text-xs">
          {label}
        </Label>
        <Input
          id={`${fieldId}-file`}
          ref={fileInputRef}
          type="file"
          accept={ECG_DOC_ACCEPT}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setValidationError(null);
            setSuccess(null);
          }}
        />
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
          A photo of the printout is fine. PDF or image, up to 10 MB.
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
        {success && <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">{success}</p>}
        {displayError && <p className="text-xs text-red-600 dark:text-red-300">{displayError}</p>}
      </div>
    </form>
  );
}
