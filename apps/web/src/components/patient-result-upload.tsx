"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadResultDocumentAsPatient } from "@/lib/lab-results/actions";
import { cancelLabResultConsultRequest } from "@/app/(dashboard)/patient/lab-result-consult-actions";
import {
  useMyLabResultConsultRequests,
  labResultConsultKeys,
} from "@/lib/queries/lab-result-consult";
import { Badge } from "@/components/ui/badge";
import {
  RESULT_DOC_ACCEPT,
  validateResultDocFile,
} from "@/lib/validation/lab-result-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  FormError,
  FormSuccess,
  fieldErrorId,
  fieldErrorProps,
} from "@/components/ui/form-error";
import {
  OTHER_TEST_TYPE_VALUE,
  RESULT_DOCUMENT_TEST_TYPE_OPTIONS,
} from "@/lib/labs/test-code-labels";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

function formatPrice(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${koboToNaira(amountMinor).toLocaleString()}`;
}

const STATUS_LABEL: Record<
  string,
  { label: string; tone: "blue" | "amber" | "green" | "red" | "grey" }
> = {
  payment_confirmed: { label: "Paid, upload your result", tone: "blue" },
  document_uploaded: { label: "Uploaded, waiting for a doctor", tone: "amber" },
  accepted: { label: "Consult booked", tone: "green" },
  cancelled: { label: "Cancelled", tone: "grey" },
  refunded: { label: "Refunded", tone: "grey" },
  expired: { label: "Expired", tone: "grey" },
};

/** A patient's own consult-fee requests, with a cancel action for anything
 * not already terminal. Optional (labOrderId-scoped upload flows can still
 * omit patientId and skip this section) rather than mandatory, since not
 * every PatientResultUpload call site had a patientId in scope worth
 * plumbing through for this alone. */
function MyConsultRequestsStatus({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const { data } = useMyLabResultConsultRequests(patientId);
  const cancel = useMutation({
    mutationFn: (requestId: string) => cancelLabResultConsultRequest(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: labResultConsultKeys.myRequests(patientId),
      });
    },
  });

  const requests = data ?? [];
  if (requests.length === 0) return null;

  return (
    <ul className="space-y-1.5 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
      {requests.map((req) => {
        const status = STATUS_LABEL[req.status] ?? {
          label: req.status,
          tone: "grey" as const,
        };
        const cancellable = !["cancelled", "refunded", "expired"].includes(
          req.status,
        );
        return (
          <li
            key={req.id}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <Badge variant={status.tone}>{status.label}</Badge>
            <span className="text-charcoal-ink/50 dark:text-night-ink/55">
              {formatPrice(req.amount_minor, req.currency)} consultation fee
            </span>
            {cancellable && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs text-red-600 dark:text-red-300"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(req.id)}
              >
                {cancel.isPending ? "Cancelling…" : "Cancel"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The patient's own "here is my result" door — the front door of the
 * self-arranged model, and the piece that was missing while the whole
 * permission chain for it already existed in the database.
 *
 * Compact by design: it renders inline under an open test request, standalone
 * (no labOrderId) for a result the patient already had from before they
 * joined, on the general "result documents" list, and after confirming a
 * screening was done elsewhere (screeningCompletionId) — one component and
 * one gated action for every patient self-upload entry point, so none of them
 * can silently drift out of sync with the others the way the general list's
 * upload form once did (it used to write straight to the table from the
 * browser, bypassing both the consult fee and the AI extraction below).
 *
 * Uploading is free — the 2026-08-30 one-off ₦10,000 consultation-fee gate
 * on the upload itself was reversed 2026-09-22 (see
 * uploadResultDocumentAsPatient's own comment): a result a patient is
 * holding must always be uploadable and readable by a doctor, whatever they
 * pay. The fee still exists as a separate, optional thing to book — a doctor
 * walkthrough of the result, offered from the AI summary card once uploaded
 * (AiResultSummary's "Discuss this with a Tarragon doctor" button), never as
 * a precondition to uploading.
 */
export function PatientResultUpload({
  labOrderId,
  screeningCompletionId,
  label = "Upload your result",
  patientId,
  testCode,
  onUploaded,
}: {
  /** Files the upload against a specific open request. Omit for a loose result. */
  labOrderId?: string;
  /** Links the upload back to a self-reported screening_completions row (see
   * ConfirmScreeningDoneForm) — optional, for the "upload your result" step
   * right after confirming a screening was done elsewhere. */
  screeningCompletionId?: string;
  label?: string;
  /** When provided, renders the patient's own consult-fee request status
   * (with a cancel action) below the upload form. */
  patientId?: string;
  /** Scopes this upload to one test within a multi-test labOrderId — the
   * per-test checklist (lab-order-test-checklist.tsx). Omit for a loose or
   * whole-order upload. */
  testCode?: string;
  /** Called after a successful upload, in addition to this component's own
   * success message — lets a parent flow (e.g. ConfirmScreeningDoneForm)
   * react without duplicating the upload/gating logic itself. */
  onUploaded?: () => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  // Only asked when the caller hasn't already scoped this upload to a known
  // test (the per-test checklist, lab-order-test-checklist.tsx, passes
  // `testCode` itself) — a loose upload has no test type to infer, and
  // knowing it is what lets the AI reader and the patient's result history
  // interpret and group it correctly.
  const [testType, setTestType] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const needsTestType = !testCode;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the result first.");
      const formData = new FormData();
      formData.set("file", file);
      if (labOrderId) formData.set("lab_order_id", labOrderId);
      if (screeningCompletionId) formData.set("screening_completion_id", screeningCompletionId);
      if (note.trim()) formData.set("note", note.trim());
      const effectiveTestCode =
        testCode ??
        (testType && testType !== OTHER_TEST_TYPE_VALUE ? testType : undefined);
      if (effectiveTestCode) formData.set("test_code", effectiveTestCode);
      const result = await uploadResultDocumentAsPatient(formData);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setSuccess("Thank you. Your care team has been asked to read it.");
      setFile(null);
      setNote("");
      setTestType("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
      onUploaded?.();
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    setValidationError(null);
    if (file) {
      const fileError = validateResultDocFile(file);
      if (fileError) {
        setValidationError(fileError);
        return;
      }
    }
    if (needsTestType && !testType) {
      setValidationError("Choose the type of test this result is for.");
      return;
    }
    upload.mutate();
  }

  const uploadErrorInstance = upload.error as Error | null;
  const displayError = validationError ?? uploadErrorInstance?.message ?? null;
  const errorId = fieldErrorId(`${fieldId}-file`);
  const hintId = `${fieldId}-file-hint`;

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-file`} className="text-xs">
            {label}
          </Label>
          <Input
            id={`${fieldId}-file`}
            ref={fileInputRef}
            type="file"
            accept={RESULT_DOC_ACCEPT}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setValidationError(null);
              setSuccess(null);
            }}
            {...fieldErrorProps(errorId, Boolean(displayError), hintId)}
          />
          <p
            id={hintId}
            className="text-xs text-charcoal-ink/50 dark:text-night-ink/55"
          >
            A photo of the printout is fine. PDF or image, up to 10 MB.
          </p>
        </div>
        {needsTestType && (
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-test-type`} className="text-xs">
              What type of test is this?
            </Label>
            <Select
              id={`${fieldId}-test-type`}
              value={testType}
              onChange={(event) => {
                setTestType(event.target.value);
                setValidationError(null);
              }}
            >
              <option value="" disabled>
                Select the test type
              </option>
              {RESULT_DOCUMENT_TEST_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              Helps your care team read it correctly and group it with related
              results.
            </p>
          </div>
        )}
        <Input
          aria-label="Anything you want your care team to know"
          placeholder="Anything you want your care team to know (optional)"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!file || (needsTestType && !testType) || upload.isPending}
          >
            {upload.isPending ? "Sending…" : "Send to my care team"}
          </Button>
          <FormSuccess message={success} className="text-xs font-medium" />
          <FormError id={errorId} message={displayError} className="text-xs" />
        </div>
      </form>

      {patientId && <MyConsultRequestsStatus patientId={patientId} />}
    </div>
  );
}
