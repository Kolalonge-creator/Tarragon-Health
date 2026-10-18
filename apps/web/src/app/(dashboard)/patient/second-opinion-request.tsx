"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useMyMembership } from "@/lib/queries/commerce";
import {
  useAcceptSecondOpinionReferral,
  useMySecondOpinionRequests,
  useSecondOpinionReferral,
  useSubmitSecondOpinionRequest,
  type SecondOpinionRequestWithAnswerer,
} from "@/lib/queries/second-opinion";
import { myLabResultsSchema, PANEL_LABEL, type PanelCode } from "@/lib/lab-results/structured";
import {
  SECOND_OPINION_DOCUMENT_MAX_BYTES,
  SECOND_OPINION_DOCUMENT_MAX_FILES,
  SECOND_OPINION_DOCUMENT_MIME,
  SPECIALIST_TYPE_LABEL,
} from "@/lib/validation/second-opinion";
import { useHasAvailableServicePurchase } from "@/lib/queries/service-purchases";
import { PayByCard } from "@/components/billing/pay-by-card";
import { secondOpinionRequestSchema } from "@/lib/validation/second-opinion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { formatPatientDate, formatPatientDateTime } from "@/lib/format-date";
import { DoctorNameLink } from "@/components/doctor-name-link";
const SECOND_OPINION_CREDIT_CODE = "second_opinion_credit";

/** The referral a doctor recommended with the answer: accept it, then take the letter anywhere. */
function RecommendedReferral({ request, patientId }: { request: SecondOpinionRequestWithAnswerer; patientId: string }) {
  const { data: referral } = useSecondOpinionReferral(request.referral_id);
  const accept = useAcceptSecondOpinionReferral(patientId);
  if (!request.referral_id || !referral) return null;
  const specialty =
    SPECIALIST_TYPE_LABEL[referral.specialist_type as keyof typeof SPECIALIST_TYPE_LABEL] ?? "a specialist";
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 p-3">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
        Your doctor suggests seeing a specialist: {specialty}
      </p>
      {referral.referral_reason && (
        <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{referral.referral_reason}</p>
      )}
      {referral.status === "draft" ? (
        <>
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            Accepting shares the relevant part of your record with the specialist and gives you a referral letter.
          </p>
          <Button size="sm" disabled={accept.isPending} onClick={() => accept.mutate(request.id)}>
            {accept.isPending ? "Accepting…" : "Accept this referral"}
          </Button>
          {accept.isError && (
            <p className="text-xs text-red-600 dark:text-red-300">Could not accept the referral. Try again.</p>
          )}
        </>
      ) : (
        <a
          className="inline-block text-sm font-medium underline"
          href={`/api/patient/referral/${referral.id}/letter`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Download your referral letter
        </a>
      )}
    </div>
  );
}

function RequestRow({
  request,
  patientId,
}: {
  request: SecondOpinionRequestWithAnswerer;
  patientId: string;
}) {
  const answered = request.status === "answered" || request.status === "closed";

  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
          {request.existing_diagnosis_or_result}
        </p>
        {answered ? (
          <Badge variant="green">Answered</Badge>
        ) : (
          <Badge variant="blue">With your care team</Badge>
        )}
      </div>
      {!answered && (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          A doctor will respond by {formatPatientDateTime(request.sla_due_at)}.
        </p>
      )}
      {answered && request.answer && (
        <div className="rounded-lg border border-brand-green/20 dark:border-brand-green-bright/20 bg-brand-green/[0.04] dark:bg-brand-green/15 p-3">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">
            {request.answer}
          </p>
          {/* Attribution is null-gated on the trigger-stamped answered_by record —
              never rendered without a real clinical_staff match. */}
          {request.answerer && request.answered_at && (
            <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Answered by <DoctorNameLink staffId={request.answerer.id} fullName={request.answerer.full_name} /> on{" "}
              {formatPatientDate(request.answered_at)}
            </p>
          )}
          <RecommendedReferral request={request} patientId={patientId} />
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
  const { data: hasCredit, isLoading: isCheckingCredit } =
    useHasAvailableServicePurchase(patientId, SECOND_OPINION_CREDIT_CODE);
  const membership = useMyMembership();
  const isMember = membership.data?.is_member === true;
  const submit = useSubmitSecondOpinionRequest();
  const [existingDiagnosisOrResult, setExistingDiagnosisOrResult] =
    useState("");
  const [sourceDescription, setSourceDescription] = useState("");
  const [specificQuestion, setSpecificQuestion] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const onPickFiles = (picked: FileList | null) => {
    const next = Array.from(picked ?? []);
    if (next.length > SECOND_OPINION_DOCUMENT_MAX_FILES) {
      setFormError(`Add at most ${SECOND_OPINION_DOCUMENT_MAX_FILES} files`);
      return;
    }
    const bad = next.find(
      (f) =>
        !(SECOND_OPINION_DOCUMENT_MIME as readonly string[]).includes(f.type) ||
        f.size > SECOND_OPINION_DOCUMENT_MAX_BYTES,
    );
    if (bad) {
      setFormError("Files must be a PDF or a photo (JPEG, PNG or WebP), 8 MB or smaller");
      return;
    }
    setFormError(null);
    setFiles(next);
  };
  // Only released, current results that carry structured values can be shown to the doctor (the database enforces the same rule).
  const { data: shareable } = useQuery({
    queryKey: ["second-opinion-shareable-results", patientId],
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_lab_results");
      if (error) throw error;
      return myLabResultsSchema
        .parse(data ?? [])
        .filter((r) => r.status === "released" && !r.replaced && r.items.length > 0);
    },
  });
  const toggleShared = (id: string) =>
    setSharedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 10 ? cur : [...cur, id]));

  if (!organisationId) return null;

  const onSubmit = () => {
    setFormError(null);
    const parsed = secondOpinionRequestSchema.safeParse({
      existingDiagnosisOrResult,
      sourceDescription: sourceDescription || undefined,
      specificQuestion: specificQuestion || undefined,
      sharedLabResultIds: sharedIds,
    });
    if (!parsed.success) {
      setFormError(
        parsed.error.issues[0]?.message ??
          "Check what you've entered and try again",
      );
      return;
    }
    submit.mutate(
      {
        patientId,
        organisationId,
        existingDiagnosisOrResult: parsed.data.existingDiagnosisOrResult,
        sourceDescription: parsed.data.sourceDescription,
        specificQuestion: parsed.data.specificQuestion,
        sharedLabResultIds: parsed.data.sharedLabResultIds,
        files,
      },
      {
        onSuccess: () => {
          setExistingDiagnosisOrResult("");
          setSourceDescription("");
          setSpecificQuestion("");
          setSharedIds([]);
          setFiles([]);
        },
        onError: (error) => {
          setFormError(
            (error as Error).message?.includes("second opinion credit")
              ? "A second opinion is an extra for Members. Buy one first."
              : (error as Error).message || "Could not send this request.",
          );
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Second opinion</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Already have a result or diagnosis from somewhere else? A doctor on
          your care team reviews it and writes back their own assessment, no
          visit needed.
        </p>

        {!isCheckingCredit && !hasCredit && isMember && (
          <div className="space-y-2 rounded-md border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              A second opinion is an extra for Members. Buy one to send a request.
            </p>
            <PayByCard
              serviceProductCode={SECOND_OPINION_CREDIT_CODE}
              callbackPath="/patient/care"
              onError={setFormError}
            />
          </div>
        )}
        {!isCheckingCredit && !hasCredit && !isMember && !membership.isLoading && (
          <div className="space-y-2 rounded-md border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green/15 p-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              A second opinion is part of Membership.{" "}
              <Link href="/patient/membership" className="font-medium underline">
                Join Membership
              </Link>
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="second-opinion-diagnosis">
            The result or diagnosis
          </Label>
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
          <Label htmlFor="second-opinion-source">
            Where is this from? (optional)
          </Label>
          <Input
            id="second-opinion-source"
            value={sourceDescription}
            onChange={(e) => setSourceDescription(e.target.value)}
            placeholder="e.g. Another hospital, a lab report, a specialist visit"
            disabled={!hasCredit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="second-opinion-question">
            A specific question? (optional)
          </Label>
          <Input
            id="second-opinion-question"
            value={specificQuestion}
            onChange={(e) => setSpecificQuestion(e.target.value)}
            placeholder="e.g. Should I get a second scan?"
            disabled={!hasCredit}
          />
        </div>
        {shareable && shareable.length > 0 && (
          <fieldset className="space-y-2" disabled={!hasCredit}>
            <legend className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
              Show the doctor your Tarragon results (optional)
            </legend>
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Only the results you tick are shown, only to the doctor reviewing this request.
            </p>
            {shareable.map((r) => (
              <label key={r.lab_result_id} className="flex min-h-11 items-center gap-2 text-sm text-charcoal-ink dark:text-night-ink">
                <input
                  type="checkbox"
                  checked={sharedIds.includes(r.lab_result_id)}
                  onChange={() => toggleShared(r.lab_result_id)}
                />
                <span>
                  {PANEL_LABEL[r.panel_code as PanelCode] ?? "Lab result"} · {formatPatientDate(r.received_at)} ·{" "}
                  {r.items.length} {r.items.length === 1 ? "value" : "values"}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="space-y-2">
          <Label htmlFor="second-opinion-files">Add reports from elsewhere (optional)</Label>
          <Input
            id="second-opinion-files"
            type="file"
            multiple
            accept={SECOND_OPINION_DOCUMENT_MIME.join(",")}
            onChange={(e) => onPickFiles(e.target.files)}
            disabled={!hasCredit}
          />
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            PDF or photo, up to {SECOND_OPINION_DOCUMENT_MAX_FILES} files of 8 MB each. Only the doctor reviewing this request sees them.
          </p>
        </div>
        {formError && (
          <p className="text-sm text-red-600 dark:text-red-300">{formError}</p>
        )}
        {submit.isSuccess && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">
            Sent. A doctor will answer here within 72 hours.
            {submit.data?.resultsAttached === false &&
              " We could not attach the results you chose, so the doctor will review your description only."}
            {(submit.data?.filesFailed ?? 0) > 0 &&
              ` ${submit.data?.filesFailed} of your files could not be uploaded; you can describe them in a message to your care team.`}
          </p>
        )}
        <Button onClick={onSubmit} disabled={submit.isPending || !hasCredit}>
          {submit.isPending ? "Sending…" : "Send for review"}
        </Button>

        {requests && requests.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 border-t border-charcoal-ink/10 dark:border-night-ink/15">
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} patientId={patientId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
