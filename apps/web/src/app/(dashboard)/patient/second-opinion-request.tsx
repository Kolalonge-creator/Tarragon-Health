"use client";

import { useState } from "react";
import {
  useMySecondOpinionRequests,
  useSubmitSecondOpinionRequest,
  type SecondOpinionRequestWithAnswerer,
} from "@/lib/queries/second-opinion";
import { useHasAvailableServicePurchase } from "@/lib/queries/service-purchases";
import { purchaseServiceProduct } from "@/lib/billing/purchase-service-product";
import { secondOpinionRequestSchema } from "@/lib/validation/second-opinion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
const SECOND_OPINION_CREDIT_CODE = "second_opinion_credit";

function RequestRow({ request }: { request: SecondOpinionRequestWithAnswerer }) {
  const answered = request.status === "answered" || request.status === "closed";
  const credential =
    request.answerer?.credential_type && request.answerer?.credential_number
      ? `${request.answerer.credential_type} ${request.answerer.credential_number}`
      : null;

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{request.existing_diagnosis_or_result}</p>
        {answered ? <Badge variant="green">Answered</Badge> : <Badge variant="blue">With your care team</Badge>}
      </div>
      {!answered && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          A doctor will respond by {formatPatientDateTime(request.sla_due_at)}.
        </p>
      )}
      {answered && request.answer && (
        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/[0.04] dark:bg-brand-green/15 p-3">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">{request.answer}</p>
          {/* Attribution is null-gated on the trigger-stamped answered_by record —
              never rendered without a real clinical_staff match. */}
          {request.answerer && request.answered_at && (
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Answered by Dr. {request.answerer.full_name}
              {credential ? ` (${credential})` : ""} on{" "}
              {formatPatientDate(request.answered_at)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Second Opinion Review — pay-per-service item, no visit needed: a patient
 * describes an existing result/diagnosis and a doctor writes back their own
 * assessment. Unlike Ask a Doctor, this has no subscription-tier bypass —
 * every request spends a second_opinion_credit, enforced server-side by
 * second_opinion_requests_enforce_credit (20260831165614).
 */
export function SecondOpinionRequestCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string | null;
}) {
  const { data: requests } = useMySecondOpinionRequests(patientId);
  const { data: hasCredit, isLoading: isCheckingCredit } = useHasAvailableServicePurchase(
    patientId,
    SECOND_OPINION_CREDIT_CODE
  );
  const submit = useSubmitSecondOpinionRequest();
  const [existingDiagnosisOrResult, setExistingDiagnosisOrResult] = useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [specificQuestion, setSpecificQuestion] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);

  if (!organisationId) return null;

  const onSubmit = () => {
    setFormError(null);
    const parsed = secondOpinionRequestSchema.safeParse({
      existingDiagnosisOrResult,
      sourceDescription: sourceDescription || undefined,
      specificQuestion: specificQuestion || undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Check what you've entered and try again");
      return;
    }
    submit.mutate(
      {
        patientId,
        organisationId,
        existingDiagnosisOrResult: parsed.data.existingDiagnosisOrResult,
        sourceDescription: parsed.data.sourceDescription,
        specificQuestion: parsed.data.specificQuestion,
      },
      {
        onSuccess: () => {
          setExistingDiagnosisOrResult("");
          setSourceDescription("");
          setSpecificQuestion("");
        },
        onError: (error) => {
          setFormError(
            (error as Error).message?.includes("second opinion credit")
              ? "Buy a second opinion credit first."
              : (error as Error).message || "Could not send this request."
          );
        },
      }
    );
  };

  async function buyCredit() {
    setIsBuying(true);
    setFormError(null);
    try {
      const result = await purchaseServiceProduct({
        serviceProductCode: SECOND_OPINION_CREDIT_CODE,
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
        <CardTitle>Second opinion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Already have a result or diagnosis from somewhere else? A doctor on your care team reviews
          it and writes back their own assessment, no visit needed.
        </p>

        {!isCheckingCredit && !hasCredit && (
          <div className="space-y-2 rounded-md border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              Buy a second opinion credit to send a request.
            </p>
            <Button size="sm" disabled={isBuying} onClick={buyCredit}>
              {isBuying ? "Redirecting to payment…" : "Buy a credit"}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="second-opinion-diagnosis">The result or diagnosis</Label>
          <Textarea
            id="second-opinion-diagnosis"
            value={existingDiagnosisOrResult}
            onChange={(e) => setExistingDiagnosisOrResult(e.target.value)}
            rows={3}
            placeholder="e.g. My GP diagnosed me with X and suggested Y. I'd like another doctor's view."
            disabled={!hasCredit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="second-opinion-source">Where is this from? (optional)</Label>
          <Input
            id="second-opinion-source"
            value={sourceDescription}
            onChange={(e) => setSourceDescription(e.target.value)}
            placeholder="e.g. Another hospital, a lab report, a specialist visit"
            disabled={!hasCredit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="second-opinion-question">A specific question? (optional)</Label>
          <Input
            id="second-opinion-question"
            value={specificQuestion}
            onChange={(e) => setSpecificQuestion(e.target.value)}
            placeholder="e.g. Should I get a second scan?"
            disabled={!hasCredit}
          />
        </div>
        {formError && <p className="text-sm text-red-600 dark:text-red-300">{formError}</p>}
        {submit.isSuccess && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">Sent. A doctor will answer here within 72 hours.</p>
        )}
        <Button onClick={onSubmit} disabled={submit.isPending || !hasCredit}>
          {submit.isPending ? "Sending…" : "Send for review"}
        </Button>

        {requests && requests.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 border-t border-charcoal-ink/10 dark:border-night-ink/15">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
