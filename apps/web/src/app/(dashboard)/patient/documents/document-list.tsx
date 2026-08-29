"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { archivePatientDocument } from "@/lib/documents/actions";
import type { PatientDocumentView } from "@/lib/documents/documents";
import { ShareDocumentPanel } from "./share-document-panel";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  laboratory_report: "Laboratory report",
  imaging_report: "Imaging report",
  referral_letter: "Referral letter",
  consultation_note: "Consultation note",
  prescription: "Prescription",
  discharge_summary: "Discharge summary",
  consent_form: "Consent form",
  invoice: "Invoice",
  insurance_document: "Insurance document",
  identification_document: "Identification document",
  clinical_photograph: "Clinical photograph",
  other: "Other",
};

const STATUS_BADGE: Record<string, { label: string; variant: BadgeProps["variant"] }> = {
  created: { label: "Processing", variant: "grey" },
  uploaded: { label: "Processing", variant: "amber" },
  validated: { label: "Validated", variant: "blue" },
  available: { label: "Available", variant: "green" },
  superseded: { label: "Superseded", variant: "grey" },
  archived: { label: "Archived", variant: "grey" },
  rejected: { label: "Rejected", variant: "red" },
};

function formatDate(value: string | null): string {
  if (!value) return "No date on file";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** One document row's archive control — a patient may only archive their own
 * documents (the RPC enforces this too; the source check here just avoids
 * showing a control that would fail). Click reveals a short reason field
 * before confirming, since `archive_patient_document` requires one. */
function ArchiveControl({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");

  const archive = useMutation({
    mutationFn: async () => {
      const result = await archivePatientDocument(documentId, reason);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      setExpanded(false);
      setReason("");
      router.refresh();
    },
  });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="text-xs font-medium text-charcoal-ink/50 hover:text-red-600 hover:underline"
      >
        Archive
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why are you archiving this?"
        className="h-8 w-48 text-xs"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!reason.trim() || archive.isPending}
        onClick={() => archive.mutate()}
      >
        {archive.isPending ? "Archiving…" : "Confirm"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setExpanded(false);
          setReason("");
        }}
      >
        Cancel
      </Button>
      {archive.isError && (
        <p className="w-full text-xs text-red-600">{(archive.error as Error).message}</p>
      )}
    </div>
  );
}

/**
 * A patient's document library, newest first (the loader already sorts by
 * document_date desc nulls last, then uploaded_at desc). Fully server-loaded
 * — the signed URL for each document is already on `doc.signedUrl`, minted
 * server-side by loadPatientDocuments; this component never fetches one
 * itself.
 */
export function DocumentList({ documents }: { documents: PatientDocumentView[] }) {
  if (documents.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No documents yet.</p>;
  }

  return (
    <ul className="space-y-4">
      {documents.map((doc) => {
        const statusBadge = STATUS_BADGE[doc.status] ?? { label: doc.status, variant: "grey" as const };
        return (
          <li
            key={doc.id}
            className="space-y-1.5 border-b border-charcoal-ink/10 pb-4 last:border-0 last:pb-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-charcoal-ink">{doc.title}</p>
                <p className="text-xs text-charcoal-ink/50">
                  {DOCUMENT_TYPE_LABEL[doc.documentType] ?? doc.documentType} ·{" "}
                  {formatDate(doc.documentDate)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                {doc.confidentiality === "patient_private" && <Badge variant="grey">Private</Badge>}
              </div>
            </div>

            <ShareDocumentPanel documentId={doc.id} />

            {doc.supersededById && (
              <p className="text-xs text-amber-700">A newer version of this document is available.</p>
            )}
            {doc.description && <p className="text-sm text-charcoal-ink/70">{doc.description}</p>}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {doc.signedUrl ? (
                <a
                  href={doc.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-brand-green hover:underline"
                >
                  {doc.isPdf ? "Open PDF →" : "View →"}
                </a>
              ) : (
                <p className="text-xs text-charcoal-ink/50">File unavailable.</p>
              )}
              {doc.source === "patient" && doc.status !== "archived" && (
                <ArchiveControl documentId={doc.id} />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
