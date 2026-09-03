"use client";

import { useActionState, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadResultDocumentAsPatient } from "@/lib/lab-results/actions";
import {
  requestLabResultConsult,
  cancelLabResultConsultRequest,
  type RequestLabResultConsultState,
} from "@/app/(dashboard)/patient/lab-result-consult-actions";
import {
  useLabResultConsultPrice,
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
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

/** Thrown by the upload mutation specifically when the DB-enforced
 * consultation-fee gate rejected it (public.claim_lab_result_consult_credit)
 * — distinguished from every other upload failure so the UI can offer a
 * "pay and continue" action instead of a dead-end error message. */
class ConsultFeeRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsultFeeRequiredError";
  }
}

function formatPrice(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${koboToNaira(amountMinor).toLocaleString()}`;
}

const STATUS_LABEL: Record<string, { label: string; tone: "blue" | "amber" | "green" | "red" | "grey" }> = {
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
      queryClient.invalidateQueries({ queryKey: labResultConsultKeys.myRequests(patientId) });
    },
  });

  const requests = data ?? [];
  if (requests.length === 0) return null;

  return (
    <ul className="space-y-1.5 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
      {requests.map((req) => {
        const status = STATUS_LABEL[req.status] ?? { label: req.status, tone: "grey" as const };
        const cancellable = !["cancelled", "refunded", "expired"].includes(req.status);
        return (
          <li key={req.id} className="flex flex-wrap items-center gap-2 text-xs">
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
 * Compact by design: it renders inline under an open test request, and also
 * standalone (no labOrderId) for a result the patient already had from before
 * they joined.
 *
 * Once uploaded, whether a doctor actually reads it is never gated by plan —
 * a result a patient is holding must always be readable by a doctor,
 * whatever they pay. Founder rule, 2026-08-30: the UPLOAD ITSELF is now
 * gated behind a one-off ₦10,000 consultation fee (a different, narrower
 * rule — see uploadResultDocumentAsPatient's own comment). Paying it also
 * books a 15-minute doctor walkthrough of the result. A rejected upload
 * shows a "pay and continue" prompt instead of a dead-end error.
 */
export function PatientResultUpload({
  labOrderId,
  label = "Upload your result",
  patientId,
}: {
  /** Files the upload against a specific open request. Omit for a loose result. */
  labOrderId?: string;
  label?: string;
  /** When provided, renders the patient's own consult-fee request status
   * (with a cancel action) below the upload form. */
  patientId?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const price = useLabResultConsultPrice();

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Attach the result first.");
      const formData = new FormData();
      formData.set("file", file);
      if (labOrderId) formData.set("lab_order_id", labOrderId);
      if (note.trim()) formData.set("note", note.trim());
      const result = await uploadResultDocumentAsPatient(formData);
      if (result.error) {
        if (result.requiresConsultFeePayment) {
          throw new ConsultFeeRequiredError(result.error);
        }
        throw new Error(result.error);
      }
    },
    onSuccess: () => {
      setSuccess("Thank you. Your care team has been asked to read it.");
      setFile(null);
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    },
  });

  const [payState, payAction, payPending] = useActionState<
    RequestLabResultConsultState,
    FormData
  >(requestLabResultConsult, undefined);

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
    upload.mutate();
  }

  const uploadErrorInstance = upload.error as Error | null;
  const requiresPayment = uploadErrorInstance instanceof ConsultFeeRequiredError;
  const displayError = validationError ?? uploadErrorInstance?.message ?? null;

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
          />
          <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
            A photo of the printout is fine. PDF or image, up to 10 MB.
          </p>
        </div>
        <Input
          aria-label="Anything you want your care team to know"
          placeholder="Anything you want your care team to know (optional)"
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="outline" disabled={!file || upload.isPending}>
            {upload.isPending ? "Sending…" : "Send to my care team"}
          </Button>
          {success && <p className="text-xs font-medium text-brand-green dark:text-brand-green-bright">{success}</p>}
          {displayError && !requiresPayment && (
            <p className="text-xs text-red-600 dark:text-red-300">{displayError}</p>
          )}
        </div>
      </form>

      {requiresPayment && (
        <div className="rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-3 space-y-2">
          <p className="text-xs text-charcoal-ink/80 dark:text-night-ink/80">
            {displayError}
            {price.data && (
              <>
                {" "}The fee is {formatPrice(price.data.amount_minor, price.data.currency)}.
              </>
            )}
          </p>
          <form action={payAction}>
            {labOrderId && <input type="hidden" name="lab_order_id" value={labOrderId} />}
            <Button type="submit" size="sm" disabled={payPending}>
              {payPending ? "Redirecting to payment…" : "Pay & continue"}
            </Button>
          </form>
          {payState?.error && <p className="text-xs text-red-600 dark:text-red-300">{payState.error}</p>}
        </div>
      )}

      {patientId && <MyConsultRequestsStatus patientId={patientId} />}
    </div>
  );
}
