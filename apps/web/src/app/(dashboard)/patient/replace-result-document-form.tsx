"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { replaceResultDocumentAsPatient } from "@/lib/lab-results/actions";
import {
  RESULT_DOC_ACCEPT,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError, FormSuccess, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

/**
 * "I uploaded the wrong file" — lets a patient swap a result document they
 * uploaded themselves for a corrected one, before anyone has reviewed it.
 * Collapsed behind a toggle rather than always showing an open file picker:
 * most uploads are never replaced, and this only ever applies to the
 * patient's own still-unreviewed upload (see ResultDocuments, which is the
 * only caller and already gates on doc.source === "patient" && !doc.reviewedAt).
 */
export function ReplaceResultDocumentForm({ documentId }: { documentId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const errorId = fieldErrorId(`replace-${documentId}`);

  const replace = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the corrected file first.");
      const formData = new FormData();
      formData.set("document_id", documentId);
      formData.set("file", file);
      const result = await replaceResultDocumentAsPatient(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setSuccess("Replaced. Your care team will see the corrected file.");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (!file) {
      setValidationError("Attach the corrected file first.");
      return;
    }
    const fileError = validateResultDocFile(file);
    if (fileError) {
      setValidationError(fileError);
      return;
    }
    replace.mutate();
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-auto px-0 text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60 hover:text-brand-green dark:hover:text-brand-green-bright"
        onClick={() => setOpen(true)}
      >
        Uploaded the wrong file? Replace it
      </Button>
    );
  }

  const displayError = validationError ?? replace.error?.message ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-2">
      <Input
        ref={fileInputRef}
        type="file"
        accept={RESULT_DOC_ACCEPT}
        aria-label="Corrected result file"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setValidationError(null);
          setSuccess(null);
        }}
        {...fieldErrorProps(errorId, Boolean(displayError))}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={!file || replace.isPending}>
          {replace.isPending ? "Replacing…" : "Replace this upload"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={replace.isPending}
          onClick={() => {
            setOpen(false);
            setFile(null);
            setValidationError(null);
          }}
        >
          Cancel
        </Button>
        <FormSuccess message={success} className="text-xs font-medium" />
        <FormError id={errorId} message={displayError} className="text-xs" />
      </div>
    </form>
  );
}
