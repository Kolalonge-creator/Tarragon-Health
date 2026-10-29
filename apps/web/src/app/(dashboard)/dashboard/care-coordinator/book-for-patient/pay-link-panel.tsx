"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaystackFeeNotice } from "@/components/billing/paystack-fee-notice";
import { formatPatientDateTime } from "@/lib/format-date";
import { createPayLink } from "./actions";

/**
 * Shown after a phone booking that is not covered by the patient's tier. The slot is held for 24 hours. Payment is by a Paystack link
 * (card or bank transfer, chosen on that page) that goes to the patient or a relative, or a sponsor's Care Voucher, which confirms the
 * booking by itself when it exists. The coordinator never types card details.
 */
export function PayLinkPanel({ appointmentId, slotStart, patientName }: { appointmentId: string; slotStart: string; patientName: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function makeLink() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const result = await createPayLink({ appointmentId, payerEmail: email });
    setBusy(false);
    if ("error" in result) setError(result.error);
    else if ("checkoutUrl" in result) setLink(result.checkoutUrl);
    else setActivated(true);
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-brand-green/30 bg-brand-green/5 p-3 dark:bg-brand-green/10">
      <p className="text-sm text-charcoal-ink dark:text-night-ink">
        The time on {formatPatientDateTime(slotStart, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} is
        held for {patientName} for 24 hours. It confirms when this is paid, and is released if it is not.
      </p>
      {activated ? (
        <p role="status" className="text-sm text-brand-green dark:text-brand-green-bright">
          Nothing is left to pay, so the booking confirms by itself.
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <label className="text-xs text-charcoal-ink/60 dark:text-night-ink/60" htmlFor="payer-email">
              Email of the person who will pay (the patient or a relative)
            </label>
            <div className="flex flex-wrap gap-2">
              <Input id="payer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className="max-w-xs" />
              <Button size="sm" disabled={busy || link !== null || email.trim() === ""} onClick={makeLink}>
                {busy ? "Making the link…" : link ? "Link made" : "Make a pay link"}
              </Button>
            </div>
          </div>
          {link && (
            <div className="space-y-2">
              <p className="break-all rounded-md bg-charcoal-ink/5 p-2 text-xs text-charcoal-ink dark:text-night-ink">{link}</p>
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </Button>
              <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                Send this link to the payer. They can pay by card or bank transfer on the page that opens. Only one link can be out at a time, so keep this page open until you have sent it. If you lose it, the booking appears in the list below with what to do next.
              </p>
            </div>
          )}
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            If a relative has bought a Care Voucher for {patientName}, the booking confirms by itself and no link is needed.
          </p>
          <PaystackFeeNotice />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
