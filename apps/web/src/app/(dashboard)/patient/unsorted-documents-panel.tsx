"use client";

import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FilePicker } from "@/components/ui/file-picker";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { RESULT_DOC_ACCEPT, validateResultDocFile } from "@/lib/validation/lab-result-documents";
import { confirmDocumentKind, uploadUnsortedDocument } from "./unsorted-documents-actions";

export interface KindOption {
  readonly code: string;
  readonly label: string;
  readonly group: string;
}

export interface UnsortedDocumentView {
  readonly id: string;
  readonly fileName: string | null;
  readonly uploadedAt: string;
  readonly status: string;
  readonly statusReason: string | null;
  readonly kindLabel: string | null;
  readonly suggestedKind: string | null;
}

const OUTCOME_MESSAGE = {
  sorted_lab: "Thanks. It looks like a lab result, so it has gone to your lab results to be read.",
  sorted_other: "Thanks. It has been saved to your record under the right type.",
  question: "Thanks. One quick question below: tell us what kind of document it is.",
  saved: "Thanks, it is saved. We are still working out what kind of document it is, and will ask you if we need to.",
} as const;

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function KindQuestion({ doc, kinds }: { doc: UnsortedDocumentView; kinds: readonly KindOption[] }) {
  const router = useRouter();
  const id = useId();
  const [kind, setKind] = useState(doc.suggestedKind ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const groups = [...new Set(kinds.map((k) => k.group))];

  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!kind) return setError("Choose a type from the list.");
        setError(null);
        start(async () => {
          const res = await confirmDocumentKind({ documentId: doc.id, kindCode: kind });
          if (!res.ok) setError(res.error);
          else router.refresh();
        });
      }}
    >
      <div className="min-w-56 flex-1 space-y-1">
        <Label htmlFor={id}>What kind of document is this?</Label>
        <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)} className="min-h-11">
          <option value="">Choose a type</option>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {kinds.filter((k) => k.group === g).map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        {doc.suggestedKind && <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">We have picked our best guess. Change it if it is wrong.</p>}
      </div>
      <Button type="submit" className="min-h-11" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </Button>
      {error && <FormError id={`${id}-error`} className="w-full" message={error} />}
    </form>
  );
}

export function UnsortedDocumentsPanel({
  documents,
  kinds,
  canUpload,
}: {
  documents: readonly UnsortedDocumentView[];
  kinds: readonly KindOption[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const fileId = useId();
  const noteId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file first.");
    const bad = validateResultDocFile(file);
    if (bad) return setError(bad);
    setError(null);
    setSuccess(null);
    start(async () => {
      const res = await uploadUnsortedDocument(data);
      if (!res.ok) return setError(res.error);
      setSuccess(OUTCOME_MESSAGE[res.outcome]);
      form.reset();
      setFileName(null);
      router.refresh();
    });
  }

  return (
    <section aria-labelledby={`${fileId}-title`} className="space-y-4 rounded-xl border border-charcoal-ink/10 dark:border-night-ink/15 p-4">
      <div>
        <h3 id={`${fileId}-title`} className="text-base font-semibold text-charcoal-ink dark:text-night-ink">
          Not sure what a document is?
        </h3>
        <p className="mt-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Upload any health document, such as a test result, a scan report or a hospital letter. We will work out where it belongs, and
          ask you if we are not sure.
        </p>
      </div>

      {canUpload && (
        <form onSubmit={onSubmit} className="space-y-3">
          <FilePicker
            id={fileId}
            name="file"
            accept={RESULT_DOC_ACCEPT}
            label="Choose a document"
            hint="PDF or photo"
            inputRef={inputRef}
            fileName={fileName}
            onFile={(f) => setFileName(f ? f.name : null)}
          />
          <div className="space-y-1">
            <Label htmlFor={noteId}>Anything we should know? (optional)</Label>
            <Textarea id={noteId} name="note" maxLength={500} rows={2} placeholder="For example: scan from the hospital in March" />
          </div>
          <Button type="submit" className="min-h-11" disabled={pending}>
            {pending ? "Uploading" : "Upload"}
          </Button>
          {error && <FormError id={`${fileId}-error`} message={error} />}
          {success && <FormSuccess message={success} />}
        </form>
      )}

      {documents.length > 0 && (
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {documents.map((doc) => (
            <li key={doc.id} className="py-3">
              <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {doc.fileName ?? "Document"} <span className="font-normal text-charcoal-ink/60 dark:text-night-ink/60">· {formatDate(doc.uploadedAt)}</span>
              </p>
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
                {doc.kindLabel ? `${doc.kindLabel}. ` : ""}
                {doc.statusReason ?? ""}
              </p>
              {canUpload && doc.status === "needs_type_confirmation" && <KindQuestion doc={doc} kinds={kinds} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
