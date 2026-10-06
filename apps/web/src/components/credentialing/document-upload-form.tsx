import { DOCUMENT_KINDS } from "@/lib/credentialing/labels";
import { uploadCredentialDocument } from "@/lib/credentialing/applicant-actions";
import { Field, fieldClass, Hidden, SubmitButton } from "./shared";

/**
 * One upload form. A plain HTML form with no client script: it works on a slow connection and on a shared phone,
 * and the server checks the real file type, size and folder before anything is stored. No applicationId means a
 * renewal for a clinician who already works here.
 */
export function DocumentUploadForm({
  kind,
  applicationId,
  returnTo,
  withExpiry = false,
  buttonLabel = "Upload",
}: {
  kind: string;
  applicationId: string | null;
  returnTo: string;
  withExpiry?: boolean;
  buttonLabel?: string;
}) {
  const meta = DOCUMENT_KINDS.find((d) => d.kind === kind);
  return (
    <form action={uploadCredentialDocument} className="flex flex-wrap items-end gap-3" encType="multipart/form-data">
      <Hidden name="kind" value={kind} />
      <Hidden name="applicationId" value={applicationId ?? ""} />
      <Hidden name="returnTo" value={returnTo} />
      <Field label={meta?.label ?? "Document"}>
        <input type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp" className="block text-sm" />
      </Field>
      {withExpiry ? (
        <Field label="Expiry date on the document">
          <input type="date" name="expires_on" className={fieldClass} />
        </Field>
      ) : null}
      <SubmitButton>{buttonLabel}</SubmitButton>
    </form>
  );
}
