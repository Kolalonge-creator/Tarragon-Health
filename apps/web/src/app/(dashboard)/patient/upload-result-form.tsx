"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useUploadOwnResultDocument } from "@/lib/queries/lab-result-documents";
import {
  RESULT_DOC_ACCEPT,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";
import {
  OTHER_TEST_TYPE_VALUE,
  RESULT_DOCUMENT_TEST_TYPE_OPTIONS,
} from "@/lib/labs/test-code-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  FormError,
  FormSuccess,
  fieldErrorId,
  fieldErrorProps,
} from "@/components/ui/form-error";

/** Patient uploads their own lab result document (PDF or photo). */
export function UploadResultForm() {
  const router = useRouter();
  const upload = useUploadOwnResultDocument();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [testType, setTestType] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
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
    if (!testType) {
      setValidationError("Choose the type of test this result is for.");
      return;
    }
    const testCode = testType === OTHER_TEST_TYPE_VALUE ? undefined : testType;
    upload.mutate(
      { file, note, testCode },
      {
        onSuccess: () => {
          setSuccess("Result uploaded. Your care team will review it.");
          setFile(null);
          setNote("");
          setTestType("");
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
    (upload.error
      ? "We could not upload that just then. Please try again."
      : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="own-result-file">Upload a result</Label>
        <Input
          id="own-result-file"
          ref={fileInputRef}
          type="file"
          accept={RESULT_DOC_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          {...fieldErrorProps(
            errorId,
            Boolean(displayError),
            "own-result-file-hint",
          )}
        />
        <p
          id="own-result-file-hint"
          className="text-xs text-charcoal-ink/60 dark:text-night-ink/60"
        >
          Got a result from a lab yourself? Add a PDF or photo (up to 10 MB) so
          your care team can see it.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-test-type`}>
          What type of test is this?
        </Label>
        <Select
          id={`${fieldId}-test-type`}
          value={testType}
          onChange={(event) => {
            setTestType(event.target.value);
            setValidationError(null);
          }}
        >
          <option value="" disabled>
            Select the test type
          </option>
          {RESULT_DOCUMENT_TEST_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          Helps your care team read it correctly and group it with related
          results.
        </p>
      </div>
      {/* This had no label at all: a screen reader announced an unlabelled
          text box, because the only description was a placeholder. */}
      <div className="space-y-1.5">
        <Label htmlFor="own-result-note">Note (optional)</Label>
        <Textarea
          id="own-result-note"
          placeholder="e.g. which lab you used"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
        />
      </div>
      <FormError id={errorId} message={displayError} />
      <FormSuccess message={success} />
      <Button type="submit" disabled={upload.isPending || !file || !testType}>
        {upload.isPending ? "Uploading…" : "Upload result"}
      </Button>
    </form>
  );
}
