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

/** Patient uploads their own lab result document (PDF or photo). */
export function UploadResultForm() {
  const router = useRouter();
  const upload = useUploadOwnResultDocument();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          setSuccess("Result uploaded — your care team will review it.");
          setFile(null);
          setNote("");
          if (fileInputRef.current) fileInputRef.current.value = "";
          router.refresh();
        },
      },
    );
  }

  const displayError = validationError ?? (upload.error as Error | null)?.message ?? null;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-charcoal-ink/10 pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="own-result-file">Upload a result</Label>
        <Input
          id="own-result-file"
          ref={fileInputRef}
          type="file"
          accept={RESULT_DOC_ACCEPT}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-charcoal-ink/60">
          Got a result from a lab yourself? Add a PDF or photo (up to 10 MB) so your care team can
          see it.
        </p>
      </div>
      <Textarea
        placeholder="Note (optional) — e.g. which lab and which test"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
      />
      {displayError && <p className="text-sm text-red-600">{displayError}</p>}
      {success && <p className="text-sm text-brand-green">{success}</p>}
      <Button type="submit" disabled={upload.isPending || !file}>
        {upload.isPending ? "Uploading…" : "Upload result"}
      </Button>
    </form>
  );
}
