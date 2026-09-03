"use client";

import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ECG_DOC_ACCEPT, validateEcgDocFile } from "@/lib/validation/ecg-report-documents";
import { uploadEcgReportForPatient } from "@/lib/ecg-reports/actions";
import { loadEcgReviewForPatient } from "./ecg-review-actions";
import { EcgReportExtractionPanel } from "./ecg-report-extraction-panel";
import { ScreeningResultForm } from "./screening-result-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The ecg_resting-specific "Enter result" surface for the screen-order
 * checklist. Combines the ECG-specific pieces (upload, AI-transcribed
 * parameter review) with the UNCHANGED procedural_status flow every other
 * screen type uses — filing parameters and recording a clinical
 * normal/borderline/abnormal/critical read stay two separate, both-required
 * acts, exactly as for any other procedural screen. See
 * ecg-report-extraction-panel.tsx's own note on why there is no clinical
 * classification anywhere in the parameter-review half of this panel.
 */
export function EcgResultPanel({
  patientId,
  labOrderId,
  onSuccess,
}: {
  patientId: string;
  labOrderId: string;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["ecg-review", patientId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => loadEcgReviewForPatient(patientId),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the ECG first.");
      const formData = new FormData();
      formData.set("file", file);
      formData.set("patient_id", patientId);
      formData.set("lab_order_id", labOrderId);
      if (note.trim()) formData.set("note", note.trim());
      const result = await uploadEcgReportForPatient(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setFile(null);
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function handleUploadSubmit(event: FormEvent) {
    event.preventDefault();
    setValidationError(null);
    if (!file) {
      setValidationError("Attach a 12-lead ECG (photo or PDF).");
      return;
    }
    const fileError = validateEcgDocFile(file);
    if (fileError) {
      setValidationError(fileError);
      return;
    }
    upload.mutate();
  }

  const displayUploadError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] p-3">
        <p className="text-xs font-medium text-charcoal-ink">
          Only a genuine 12-lead ECG, the kind done at a hospital or lab, showing 12 strips
          labelled I, II, III, aVR, aVL, aVF, V1&ndash;V6. Not a Watch or single-lead strip.
        </p>
        <form onSubmit={handleUploadSubmit} className="mt-2 space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="ecg-upload-file" className="text-xs">
              Upload the ECG
            </Label>
            <Input
              id="ecg-upload-file"
              ref={fileInputRef}
              type="file"
              accept={ECG_DOC_ACCEPT}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setValidationError(null);
              }}
            />
          </div>
          <Input
            aria-label="Note (optional)"
            placeholder="Note (optional): e.g. which facility"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!file || upload.isPending}>
            {upload.isPending ? "Uploading…" : "Upload ECG"}
          </Button>
          {displayUploadError && <p className="text-xs text-red-600">{displayUploadError}</p>}
        </form>
      </div>

      {isLoading ? (
        <p className="text-xs text-charcoal-ink/50">Loading uploaded ECGs…</p>
      ) : data && data.documents.length > 0 ? (
        <ul className="space-y-3">
          {data.documents.map((doc) => (
            <li key={doc.id}>
              <EcgReportExtractionPanel
                documentId={doc.id}
                signedUrl={doc.signedUrl}
                isPdf={doc.isPdf}
                patientName={data.patientName}
                extraction={data.extractionByDocument[doc.id] ?? null}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-charcoal-ink/50">
          No ECG uploaded yet for this patient. Upload one above, or the patient can upload it
          themselves.
        </p>
      )}

      <div className="border-t border-charcoal-ink/10 pt-3">
        <p className="mb-2 text-xs font-medium text-charcoal-ink">Your clinical read</p>
        <ScreeningResultForm
          patientId={patientId}
          labOrderId={labOrderId}
          lockedScreenType="ecg_resting"
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}
