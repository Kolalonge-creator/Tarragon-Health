"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useUploadOwnResultDocument } from "@/lib/queries/lab-result-documents";
import {
  RESULT_DOC_ACCEPT,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/** Patient uploads their own lab result document (PDF or photo). */
export function UploadResultForm() {
  const router = useRouter();
  const upload = useUploadOwnResultDocument();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorId = fieldErrorId("own-result-file");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (!file) {
      setValidationError("Attach a PDF or photo of your result.");
      return;
    }
    const fileError = validateResultDocFile(file);
    if (fileError) {
      setValidationError(fileError);
      return;
    }
    upload.mutate(
      { file, note },
      {
        onSuccess: () => {
          setSuccess("Result uploaded. Your care team will review it.");
          setFile(null);
          setNote("");
          if (fileInputRef.current) fileInputRef.current.value = "";
          router.refresh();
        },
      },
    );
  }

  // `validationError` is ours (validateResultDocFile) and already reads as
  // English. The mutation's error is a raw Supabase Storage/PostgREST string
  // and used to be printed verbatim under the field.
  const displayError =
    validationError ??
    (upload.error ? "We could not upload that just then. Please try again." : null);

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="own-result-file">Upload a result</Label>
        <Input
          id="own-result-file"
          ref={fileInputRef}
          type="file"
          accept={RESULT_DOC_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          {...fieldErrorProps(errorId, Boolean(displayError), "own-result-file-hint")}
        />
        <p
          id="own-result-file-hint"
          className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
        >
          Got a result from a lab yourself? Add a PDF or photo (up to 10 MB) so your care team can
          see it.
        </p>
      </div>
      {/* This had no label at all: a screen reader announced an unlabelled
          text box, because the only description was a placeholder. */}
      <div className="space-y-1.5">
        <Label htmlFor="own-result-note">Note (optional)</Label>
        <Textarea
          id="own-result-note"
          placeholder="e.g. which lab and which test"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
      </div>
      <FormError id={errorId} message={displayError} />
      <FormSuccess message={success} />
      <Button type="submit" disabled={upload.isPending || !file}>
        {upload.isPending ? "Uploading…" : "Upload result"}
      </Button>
    </form>
  );
}
