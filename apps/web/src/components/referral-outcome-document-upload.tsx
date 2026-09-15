"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  uploadReferralOutcomeDocumentAsPatient,
  uploadReferralOutcomeDocumentForPatient,
} from "@/lib/referrals/actions";
import {
  REFERRAL_OUTCOME_DOC_ACCEPT,
  validateReferralOutcomeDocFile,
} from "@/lib/validation/specialist-referral-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Fulfils the upload promise referral-letter-document.tsx already makes to
 * the patient ("upload it in the app") — task spec §11.13. Works from
 * either surface: the patient's own referral card, or a clinician's
 * referral detail page uploading on the patient's behalf (asStaff=true
 * routes to the service-role action instead).
 */
export function ReferralOutcomeDocumentUpload({
  referralId,
  asStaff = false,
}: {
  referralId: string;
  asStaff?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the document first.");
      const formData = new FormData();
      formData.set("file", file);
      formData.set("referral_id", referralId);
      const result = asStaff
        ? await uploadReferralOutcomeDocumentForPatient(formData)
        : await uploadReferralOutcomeDocumentAsPatient(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setSuccess("Saved. Your care team can now see it.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (file) {
      const fileError = validateReferralOutcomeDocFile(file);
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
          {asStaff ? "Upload the specialist's letter or report" : "Upload what the specialist gave you"}
        </Label>
        <Input
          id={`${fieldId}-file`}
          ref={fileInputRef}
          type="file"
          accept={REFERRAL_OUTCOME_DOC_ACCEPT}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setValidationError(null);
            setSuccess(null);
          }}
        />
        <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">A photo of the printout is fine. PDF or image, up to 10 MB.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={!file || upload.isPending}>
          {upload.isPending ? "Uploading…" : "Save document"}
        </Button>
        {success && <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">{success}</p>}
        {displayError && <p className="text-xs text-red-600 dark:text-red-300">{displayError}</p>}
      </div>
    </form>
  );
}
