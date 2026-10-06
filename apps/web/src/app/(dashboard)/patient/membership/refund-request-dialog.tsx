"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess } from "@/components/ui/form-error";
import { formatKobo } from "@/lib/format-money";
import { useRequestOrderRefund } from "@/lib/queries/order-refunds";
import { cn } from "@/lib/utils";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const MIN_REASON_LENGTH = 5;

export function RefundRequestDialog({
  orderId,
  itemName,
  amountKobo,
  open,
  onOpenChange,
  locale,
}: {
  orderId: string;
  itemName: string;
  amountKobo: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `refund-title-${orderId}`;
  const [reason, setReason] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const request = useRequestOrderRefund();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function close() {
    setReason("");
    setSuccessMsg(null);
    setErrorMsg(null);
    onOpenChange(false);
  }

  async function submit() {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await request.mutateAsync({ orderId, reason: reason.trim() });
      if (result?.result === "requested" || result?.result === "ok") {
        setSuccessMsg(t("refund.request.success", locale));
        setTimeout(close, 1500);
      } else if (result?.result === "already_requested") {
        setErrorMsg(t("refund.request.already_requested", locale));
      } else if (result?.result === "order_not_paid") {
        setErrorMsg(t("refund.request.order_not_paid", locale));
      } else if (result?.result === "reason_too_short") {
        setErrorMsg(t("refund.request.reason_too_short", locale));
      } else {
        setErrorMsg(t("refund.request.error", locale));
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t("refund.request.error", locale));
    }
  }

  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => {
        if (open) close();
      }}
      className={cn(
        "w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-charcoal-ink/10 bg-white p-0 text-charcoal-ink shadow-lg",
        "backdrop:bg-charcoal-ink/40 dark:border-night-ink/15 dark:bg-night-card dark:text-night-ink",
      )}
    >
      <div className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 id={titleId} className="font-heading text-lg font-semibold">
            {t("refund.request.title", locale)}
          </h2>
          <p className={`text-sm ${MUTED}`}>
            {itemName} ({formatKobo(amountKobo)})
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor={`refund-reason-${orderId}`} className="text-sm font-medium">
            {t("refund.request.reason_label", locale)}
          </label>
          <textarea
            id={`refund-reason-${orderId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("refund.request.reason_placeholder", locale)}
            rows={3}
            className={cn(
              "w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 py-2 text-sm",
              "placeholder:text-charcoal-ink/40 focus:outline-none focus:ring-2 focus:ring-tarragon-green/50",
              "dark:border-night-ink/20 dark:placeholder:text-night-ink/40 dark:focus:ring-tarragon-green/50",
            )}
          />
        </div>

        <FormError id={`refund-error-${orderId}`} message={errorMsg} />
        <FormSuccess message={successMsg} />

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={close} disabled={request.isPending}>
            {t("common.cancel", locale)}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!reasonValid || request.isPending || successMsg !== null}
            onClick={submit}
          >
            {request.isPending ? t("refund.request.submitting", locale) : t("refund.request.submit", locale)}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
