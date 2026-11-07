import { Badge } from "@/components/ui/badge";
import { DOCUMENT_KIND_LABEL, documentScanNote } from "@/lib/credentialing/labels";

/**
 * A credential document's name, as a link to open it, or as plain text with a label when it is held for its malware scan
 * (it cannot be opened yet, so there is nothing to click). Shared by the application review and the licences-and-cover table.
 */
export function CredentialDocumentLink({ id, kind, scanStatus }: { id: string; kind: string; scanStatus: string }) {
  const name = DOCUMENT_KIND_LABEL[kind] ?? kind;
  const note = documentScanNote(scanStatus);
  if (!note) {
    return (
      <a href={`/api/credentialing/documents/${id}`} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-green underline">
        {name}
      </a>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium">{name}</span>
      <Badge variant={note.tone}>{note.label}</Badge>
    </span>
  );
}

/** True when the document cannot be marked as checked or used as renewal evidence yet. */
export function isScanHeld(scanStatus: string): boolean {
  return documentScanNote(scanStatus) !== null;
}
