"use client";

import { useActionState, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { uploadResultDocumentAsPatient } from "@/lib/lab-results/actions";
import {
  requestLabResultConsult,
  type RequestLabResultConsultState,
} from "@/app/(dashboard)/patient/lab-result-consult-actions";
import { useLabResultConsultPrice } from "@/lib/queries/lab-result-consult";
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
}: {
  /** Files the upload against a specific open request. Omit for a loose result. */
  labOrderId?: string;
  label?: string;
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
          <p className="text-xs text-charcoal-ink/50">
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
          {success && <p className="text-xs font-medium text-brand-green">{success}</p>}
          {displayError && !requiresPayment && (
            <p className="text-xs text-red-600">{displayError}</p>
          )}
        </div>
      </form>

      {requiresPayment && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs text-charcoal-ink/80">
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
          {payState?.error && <p className="text-xs text-red-600">{payState.error}</p>}
        </div>
      )}
    </div>
  );
}
