"use client";

import { useMyVerifiedDocuments, type VerifiedDocument } from "@/lib/queries/verified-documents";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Enums } from "@tarragon/shared";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";

/** Typed off the enum, not a hand-written union, so a future document type
 * fails the build here rather than being silently unreachable. Labels here
 * are the patient-facing short form; the PDF's own title (set in
 * lib/verified-documents/verified-document.tsx) is worded slightly more
 * formally and is what actually prints. */
const DOCUMENT_TYPE_LABEL: Record<Enums<"verified_document_type">, string> = {
  fit_to_work: "Fit-to-work letter",
  return_to_work: "Return-to-work letter",
  travel_health_certificate: "Travel health certificate",
  medication_carry_letter: "Medication carry letter",
  specialist_referral_letter: "Specialist referral letter",
  school_health_form: "School health form",
  insurance_medical_summary: "Insurance medical summary",
};

function DocumentRow({ document }: { document: VerifiedDocument }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div>
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {DOCUMENT_TYPE_LABEL[document.document_type] ??
            document.document_type.replace(/_/g, " ")}
        </p>
        {document.status === "requested" && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            With your care team · a doctor will respond by{" "}
            {formatPatientDateTime(document.sla_due_at)}
          </p>
        )}
        {document.status === "declined" && (
          <p className="text-xs text-red-600 dark:text-red-300">
            Not issued
            {document.declined_reason ? `: ${document.declined_reason}` : ""}
          </p>
        )}
        {document.status === "issued" && document.valid_from && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Valid from {formatPatientDate(document.valid_from)}
            {document.valid_until
              ? ` to ${formatPatientDate(document.valid_until)}`
              : ""}
          </p>
        )}
      </div>
      {document.status === "issued" ? (
        <Badge variant="green">Issued</Badge>
      ) : document.status === "declined" ? (
        <Badge variant="grey">Declined</Badge>
      ) : (
        <Badge variant="blue">Requested</Badge>
      )}
      {document.status === "issued" && (
        <a
          href={`/api/patient/verified-documents/${document.id}/pdf`}
          className="text-xs font-medium text-brand-green dark:text-brand-green-bright underline"
        >
          Download PDF
        </a>
      )}
    </li>
  );
}

/**
 * Verified Digital Documents — retired from patient purchase 2026-09-24
 * (founder decision; see migration
 * 20260924055301_retire_senior_case_review_verified_documents_confidential_message.sql).
 * There is no request form here any more, only a read-only history so a
 * patient with a document already requested or issued before the retirement
 * still has somewhere to find and download it. Renders nothing once a
 * patient has no documents at all.
 */
export function VerifiedDocumentsCard({ patientId }: { patientId: string }) {
  const { data: documents } = useMyVerifiedDocuments(patientId);

  if (!documents || documents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verified documents</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {documents.map((d) => (
            <DocumentRow key={d.id} document={d} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
