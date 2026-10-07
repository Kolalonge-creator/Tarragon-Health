"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVerifyOrder } from "@/lib/queries/commerce";

type View = "checking" | "paid" | "pending" | "failed" | "mismatch";
const POLL_MS = 4000;
const MAX_POLLS = 30;

/**
 * The page Paystack sends the patient back to. Coming back proves nothing: it asks our server, which asks Paystack, and shows
 * what is true. A bank transfer or USSD payment can settle late, so it keeps asking for a couple of minutes and then tells the
 * patient they can leave (the webhook and the sweeper finish the job either way).
 */
export function PaidStatus({ reference, locale }: { reference: string | null; locale: Locale }) {
  const { mutateAsync } = useVerifyOrder();
  const [view, setView] = useState<View>("checking");
  const [round, setRound] = useState(0);

  // Each round asks once and, while the payment is still pending, schedules the next. A new `round` (the button) starts a fresh run.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let polls = 0;
    async function check() {
      if (!reference) return setView("failed");
      polls += 1;
      let next: View = "pending";
      try {
        const r = await mutateAsync(reference);
        if (r.state === "paid" || r.state === "refunded") next = "paid";
        else if (r.outcome === "mismatch") next = "mismatch";
        else if (r.state === "failed" || r.state === "cancelled" || r.outcome === "unpaid") next = "failed";
      } catch {
        next = "pending";
      }
      if (cancelled) return;
      setView(next);
      if (next === "pending" && polls < MAX_POLLS) timer = setTimeout(() => void check(), POLL_MS);
    }
    void check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reference, round, mutateAsync]);

  const title = view === "paid" ? t("shop.return.paid.title", locale) : t("shop.title", locale);
  const body =
    view === "checking" ? t("shop.return.checking", locale)
    : view === "paid" ? t("shop.return.paid.body", locale)
    : view === "pending" ? t("shop.return.pending", locale)
    : view === "mismatch" ? t("shop.return.mismatch", locale)
    : t("shop.return.failed", locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" aria-live="polite">{body}</p>
        {view === "pending" ? (
          <Button type="button" className="min-h-11" onClick={() => { setView("checking"); setRound((n) => n + 1); }}>
            {t("shop.return.check_again", locale)}
          </Button>
        ) : null}
        <Link href="/patient/membership" className="inline-block min-h-11 underline">{t("shop.title", locale)}</Link>
      </CardContent>
    </Card>
  );
}
