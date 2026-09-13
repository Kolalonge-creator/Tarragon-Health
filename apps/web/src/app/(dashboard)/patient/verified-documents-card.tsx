"use client";

import { useState } from "react";
import {
  useMyVerifiedDocuments,
  useRequestVerifiedDocument,
  type VerifiedDocument,
} from "@/lib/queries/verified-documents";
import { useHasAvailableServicePurchase } from "@/lib/queries/service-purchases";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { PaystackFeeNotice } from "@/components/billing/paystack-fee-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Enums } from "@tarragon/shared";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";

/** Legacy flat credit, retired 2026-09-10 (service_products.is_active = false)
 * but still honoured for anyone who bought one before the per-type split —
 * see private.enforce_verified_document_credit's fallback. Never sold again;
 * only checked here so a patient who already holds one isn't blocked. */
const LEGACY_VERIFIED_DOCUMENT_CREDIT_CODE = "verified_document_credit";

/** Every document type is its own service_products code, priced individually
 * (migration 20260910011848_doctor_time_price_ladder_and_result_interpretation.sql).
 * The code is always this prefix plus the enum value — see
 * private.enforce_verified_document_credit, which builds the same string. */
function serviceProductCodeFor(
  documentType: Enums<"verified_document_type">,
): string {
  return `verified_document_${documentType}`;
}

/** Typed off the enum, not a hand-written union, so a future document type
 * fails the build here rather than being silently unreachable — same
 * discipline as DOCUMENT_TITLE in lib/verified-documents/verified-document.tsx.
 * Labels here are the patient-facing short form; the PDF's own title (set in
 * that file) is worded slightly more formally and is what actually prints. */
const DOCUMENT_TYPE_LABEL: Record<Enums<"verified_document_type">, string> = {
  fit_to_work: "Fit-to-work letter",
  return_to_work: "Return-to-work letter",
  travel_health_certificate: "Travel health certificate",
  medication_carry_letter: "Medication carry letter",
  specialist_referral_letter: "Specialist referral letter",
  school_health_form: "School health form",
  insurance_medical_summary: "Insurance medical summary",
};

const DOCUMENT_TYPE_OPTIONS = Object.keys(
  DOCUMENT_TYPE_LABEL,
) as Enums<"verified_document_type">[];

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
 * Verified Digital Documents — pay-per-service item, no plan bypass: any of
 * the seven doctor-attested document types (see DOCUMENT_TYPE_LABEL), each
 * priced and sold as its own credit, delivered as a signed PDF once issued.
 */
export function VerifiedDocumentsCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: documents } = useMyVerifiedDocuments(patientId);
  const [documentType, setDocumentType] =
    useState<Enums<"verified_document_type">>("fit_to_work");
  const typeSpecificCode = serviceProductCodeFor(documentType);
  // A patient can hold either the credit priced for this specific document
  // type, or a pre-2026-09-10 legacy flat credit — either satisfies the
  // request-side trigger, so either should unlock the form here.
  const { data: hasTypeCredit, isLoading: isCheckingTypeCredit } =
    useHasAvailableServicePurchase(patientId, typeSpecificCode);
  const { data: hasLegacyCredit, isLoading: isCheckingLegacyCredit } =
    useHasAvailableServicePurchase(
      patientId,
      LEGACY_VERIFIED_DOCUMENT_CREDIT_CODE,
    );
  const hasCredit = Boolean(hasTypeCredit || hasLegacyCredit);
  const isCheckingCredit = isCheckingTypeCredit || isCheckingLegacyCredit;
  const request = useRequestVerifiedDocument();
  const [requestNote, setRequestNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  if (!organisationId) return null;

  function onSubmit() {
    setFormError(null);
    if (!organisationId) return;
    request.mutate(
      {
        patientId,
        organisationId,
        documentType,
        requestNote: requestNote || undefined,
      },
      {
        onSuccess: () => setRequestNote(""),
        onError: (error) =>
          setFormError(
            (error as Error).message || "Could not send this request.",
          ),
      },
    );
  }

  async function buyCredit() {
    setIsBuying(true);
    setFormError(null);
    try {
      const result = await purchaseServiceProduct({
        serviceProductCode: typeSpecificCode,
        callbackPath: "/patient/care",
      });
      if (result?.error) {
        setFormError(result.error);
        return;
      }
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
    } finally {
      setIsBuying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Verified documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          A doctor-attested letter or summary — a fit-to-work note, a travel
          health letter, a specialist referral and more — delivered as a signed
          PDF, no printing or courier needed.
        </p>

        {!isCheckingCredit && !hasCredit && (
          <div className="space-y-2 rounded-md border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              Buy a credit for this document type to request it.
            </p>
            <Button size="sm" disabled={isBuying} onClick={buyCredit}>
              {isBuying
                ? "Redirecting to payment…"
                : `Buy a ${DOCUMENT_TYPE_LABEL[documentType].toLowerCase()} credit`}
            </Button>
            <PaystackFeeNotice />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="verified-document-type">Document type</Label>
          <Select
            id="verified-document-type"
            value={documentType}
            onChange={(e) =>
              setDocumentType(e.target.value as Enums<"verified_document_type">)
            }
          >
            {DOCUMENT_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {DOCUMENT_TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="verified-document-note">Details (optional)</Label>
          <Input
            id="verified-document-note"
            value={requestNote}
            onChange={(e) => setRequestNote(e.target.value)}
            placeholder="e.g. Employer name, or destination and travel dates"
            disabled={!hasCredit}
          />
        </div>
        {formError && (
          <p className="text-sm text-red-600 dark:text-red-300">{formError}</p>
        )}
        {request.isSuccess && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">
            Sent. A doctor will respond within 72 hours.
          </p>
        )}
        <Button onClick={onSubmit} disabled={request.isPending || !hasCredit}>
          {request.isPending ? "Sending…" : "Request document"}
        </Button>

        {documents && documents.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 border-t border-charcoal-ink/10 dark:border-night-ink/15">
            {documents.map((d) => (
              <DocumentRow key={d.id} document={d} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
