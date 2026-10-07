"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { requestDocumentReadingAction } from "@/lib/document-capture/actions";
import { DOCUMENT_CAPTURE_TYPES, type DocumentCaptureType } from "@/lib/document-capture/suggestions";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

const BUCKET = "patient-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

function extensionOf(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return file.type === "application/pdf" ? "pdf" : "jpg";
}

/**
 * Camera or file picker, then upload, then (only when reading is open) a request
 * to read it. The photo is stored first and always kept: a failed or declined
 * reading never loses it. On a phone the file input opens the camera
 * (`capture`), and the phone's own crop and rotate apply before the file is
 * chosen; an in-app crop is not built (recorded in docs/design/S43.md).
 */
export function DocumentCapture({
  patientId,
  organisationId,
  readingOpen,
  locale,
}: {
  patientId: string;
  organisationId: string;
  readingOpen: boolean;
  locale: Locale;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<DocumentCaptureType>("prescription");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setError(null);
    setMessage(null);
    if (file.size > MAX_BYTES) {
      setError(t("passport.documents.too_big", locale));
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const path = `${patientId}/${crypto.randomUUID()}.${extensionOf(file)}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError(t("passport.documents.upload_failed", locale));
        return;
      }
      const { data: row, error: insertError } = await supabase
        .from("patient_documents")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          document_type: type,
          file_path: path,
          original_filename: file.name.slice(0, 200),
          mime_type: file.type || null,
          file_size_bytes: file.size,
          source: "patient",
          // Only ask for a reading when reading is open; otherwise the photo is a plain upload.
          ocr_state: readingOpen ? "pending" : null,
        })
        .select("id")
        .single();
      if (insertError || !row) {
        setError(t("passport.documents.upload_failed", locale));
        return;
      }
      if (readingOpen) {
        const res = await requestDocumentReadingAction(row.id);
        setMessage(res.error ?? res.message ?? t("passport.documents.saved", locale));
      } else {
        setMessage(t("passport.documents.saved_no_reading", locale));
      }
      if (input.current) input.current.value = "";
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("passport.documents.add_title", locale)}</CardTitle>
        <CardDescription>
          {readingOpen ? t("passport.documents.add_reading_on", locale) : t("passport.documents.add_reading_off", locale)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Label htmlFor="doc-type" className="text-sm">
            {t("passport.documents.type_label", locale)}
          </Label>
          <Select id="doc-type" className="sm:w-64" value={type} onChange={(e) => setType(e.target.value as DocumentCaptureType)}>
            {DOCUMENT_CAPTURE_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`passport.documents.type.${v}` as MessageKey, locale)}
              </option>
            ))}
          </Select>
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="sr-only"
          id="doc-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <Button type="button" disabled={pending} onClick={() => input.current?.click()} className="w-full sm:w-auto">
          {pending ? t("passport.documents.working", locale) : t("passport.documents.choose", locale)}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
