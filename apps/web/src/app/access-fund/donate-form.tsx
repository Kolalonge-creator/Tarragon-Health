"use client";

import { useState } from "react";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { formatNaira } from "@tarragon/commerce";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { useCancelMyDonation, useMyDonations, usePledgeDonation } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70";
const say = (key: string, params?: Record<string, string | number>) => (Object.hasOwn(en, key) ? t(key as MessageKey, "en", params) : "");
const errorKey = (message: string) => {
  if (message.includes("access_fund_not_open")) return "fund.error.not_open";
  if (message.includes("donation_amount_invalid")) return "fund.error.amount";
  if (message.includes("too_many_open_pledges")) return "fund.error.too_many";
  return "fund.error.unknown";
};

/** A pledge, not a payment: the person gets a reference to quote with a bank transfer, and our team confirms the gift when it arrives. */
export function DonateForm() {
  const pledge = usePledgeDonation();
  const mine = useMyDonations();
  const cancel = useCancelMyDonation();
  const [naira, setNaira] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const n = Number(naira);
    if (!Number.isInteger(n) || n <= 0) { setError(say("fund.error.amount")); return; }
    try {
      const r = await pledge.mutateAsync({ amountKobo: n * 100 });
      setDone(say("fund.give.done", { reference: r.reference, days: 14 }));
      setNaira("");
    } catch (err) {
      setError(say(errorKey(err instanceof Error ? err.message : "")));
    }
  }

  return (
    <div className="space-y-4">
      <p className={MUTED}>{say("fund.give.how")}</p>
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="fund-naira" className="block font-medium text-charcoal-ink">{say("fund.give.amount")}</label>
        <input id="fund-naira" inputMode="numeric" value={naira} onChange={(e) => setNaira(e.target.value)} className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2" autoComplete="off" />
        <Button type="submit" className="min-h-11" disabled={pledge.isPending}>{pledge.isPending ? say("fund.give.submitting") : say("fund.give.submit")}</Button>
        <FormError id="fund-give-error" message={error} />
        {done ? <p role="status" className="text-charcoal-ink">{done}</p> : null}
      </form>
      <section aria-labelledby="mine" className="space-y-2">
        <h3 id="mine" className="font-medium text-charcoal-ink">{say("fund.give.mine")}</h3>
        {(mine.data ?? []).length === 0 ? <p className={MUTED}>{say("fund.give.none")}</p> : (
          <ul className="divide-y">
            {(mine.data ?? []).map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-charcoal-ink">
                <span>{d.reference}: {`₦${formatNaira(d.amountKobo)}`}, {say(`fund.state.${d.state}`)} ({formatPatientDate(d.createdAt)})</span>
                {d.state === "pledged" ? (
                  <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={cancel.isPending} onClick={() => cancel.mutate(d.id)}>{say("fund.give.cancel")}</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
