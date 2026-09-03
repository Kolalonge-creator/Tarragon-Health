"use client";

import { useState } from "react";
import {
  useMyVerifiedDocuments,
  useRequestVerifiedDocument,
  type VerifiedDocument,
} from "@/lib/queries/verified-documents";
import { useHasAvailableServicePurchase } from "@/lib/queries/service-purchases";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
const VERIFIED_DOCUMENT_CREDIT_CODE = "verified_document_credit";

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  fit_to_work: "Fit-to-work letter",
  travel_health_certificate: "Travel health certificate",
};

function DocumentRow({ document }: { document: VerifiedDocument }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div>
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {DOCUMENT_TYPE_LABEL[document.document_type] ?? document.document_type.replace(/_/g, " ")}
        </p>
        {document.status === "requested" && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            With your care team · a doctor will respond by{" "}
            {formatPatientDateTime(document.sla_due_at)}
          </p>
        )}
        {document.status === "declined" && (
          <p className="text-xs text-red-600 dark:text-red-300">
            Not issued{document.declined_reason ? `: ${document.declined_reason}` : ""}
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
 * Verified Digital Documents — pay-per-service item, no plan bypass: a
 * fit-to-work letter or travel health certificate, doctor-attested and
 * delivered as a signed PDF once issued.
 */
export function VerifiedDocumentsCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: documents } = useMyVerifiedDocuments(patientId);
  const { data: hasCredit, isLoading: isCheckingCredit } = useHasAvailableServicePurchase(
    patientId,
    VERIFIED_DOCUMENT_CREDIT_CODE
  );
  const request = useRequestVerifiedDocument();
  const [documentType, setDocumentType] = useState<"fit_to_work" | "travel_health_certificate">(
    "fit_to_work"
  );
  const [requestNote, setRequestNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  if (!organisationId) return null;

  function onSubmit() {
    setFormError(null);
    if (!organisationId) return;
    request.mutate(
      { patientId, organisationId, documentType, requestNote: requestNote || undefined },
      {
        onSuccess: () => setRequestNote(""),
        onError: (error) => setFormError((error as Error).message || "Could not send this request."),
      }
    );
  }

  async function buyCredit() {
    setIsBuying(true);
    setFormError(null);
    try {
      const result = await purchaseServiceProduct({
        serviceProductCode: VERIFIED_DOCUMENT_CREDIT_CODE,
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
          A doctor-attested fit-to-work letter or travel health certificate, delivered as a signed
          PDF, no printing or courier needed.
        </p>

        {!isCheckingCredit && !hasCredit && (
          <div className="space-y-2 rounded-md border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">Buy a credit to request a document.</p>
            <Button size="sm" disabled={isBuying} onClick={buyCredit}>
              {isBuying ? "Redirecting to payment…" : "Buy a credit"}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="verified-document-type">Document type</Label>
          <Select
            id="verified-document-type"
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value as typeof documentType)}
            disabled={!hasCredit}
          >
            <option value="fit_to_work">Fit-to-work letter</option>
            <option value="travel_health_certificate">Travel health certificate</option>
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
        {formError && <p className="text-sm text-red-600 dark:text-red-300">{formError}</p>}
        {request.isSuccess && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">Sent. A doctor will respond within 72 hours.</p>
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
