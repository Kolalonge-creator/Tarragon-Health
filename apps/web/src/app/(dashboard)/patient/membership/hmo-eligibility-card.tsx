"use client";

import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { formatPatientDate } from "@/lib/format-date";
import { hmoErrorKey } from "@/lib/commerce/model";
import { CheckoutError, useHmoPlans, useMyHmoChecks, useRequestHmoCheck } from "@/lib/queries/commerce";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";
const RESULT_KEYS = {
  eligible: "hmo.result.eligible",
  not_eligible: "hmo.result.not_eligible",
  pending_manual: "hmo.result.pending_manual",
} as const;

/**
 * Check my health plan (S71, 19.6). Shown only when at least one health plan (HMO) has a Tarragon programme. The member number is typed here,
 * sent once to the hmo-eligibility function and never shown again; the screen lists the plan name, the result and the date only. A check that the
 * HMO cannot answer automatically is left for the care operations team and says so, so nobody is told "no" because a connection failed.
 */
export function HmoEligibilityCard({ locale }: { locale: Locale }) {
  const plans = useHmoPlans();
  const checks = useMyHmoChecks();
  const request = useRequestHmoCheck();
  const [hmoId, setHmoId] = useState("");
  const [number, setNumber] = useState("");
  const [errorKey, setErrorKey] = useState<ReturnType<typeof hmoErrorKey> | null>(null);
  const [resultKey, setResultKey] = useState<(typeof RESULT_KEYS)[keyof typeof RESULT_KEYS] | null>(null);

  const list = plans.data ?? [];
  // nothing to show until a health plan with an agreement exists
  if (!plans.isSuccess || list.length === 0) return null;
  const selected = hmoId || list[0]!.hmo_id;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setResultKey(null);
    try {
      const r = await request.mutateAsync({ hmoId: selected, memberNumber: number.trim() });
      setResultKey(RESULT_KEYS[r.result]);
      setNumber("");
    } catch (err) {
      setErrorKey(hmoErrorKey(err instanceof CheckoutError ? err.code : "unknown"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("hmo.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={MUTED}>{t("hmo.intro", locale)}</p>
        <form onSubmit={submit} className="space-y-3" aria-label={t("hmo.title", locale)}>
          <div>
            <label htmlFor="hmo-plan" className="mb-1 block font-medium">{t("hmo.field.plan", locale)}</label>
            <select id="hmo-plan" value={selected} onChange={(e) => setHmoId(e.target.value)} className={`${TOUCH} w-full rounded-md border border-input bg-background px-3 py-2`}>
              {list.map((p) => (
                <option key={p.hmo_id} value={p.hmo_id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="hmo-number" className="mb-1 block font-medium">{t("hmo.field.number", locale)}</label>
            <input
              id="hmo-number" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={60}
              aria-describedby="hmo-number-hint" className={`${TOUCH} w-full rounded-md border border-input bg-background px-3 py-2`}
            />
            <p id="hmo-number-hint" className={`mt-1 text-sm ${MUTED}`}>{t("hmo.hint.number", locale)}</p>
          </div>
          <Button type="submit" className={TOUCH} disabled={request.isPending || number.trim().length < 4}>
            {request.isPending ? t("hmo.submitting", locale) : t("hmo.submit", locale)}
          </Button>
        </form>
        {resultKey ? <p role="status">{t(resultKey, locale)}</p> : null}
        <FormError id="hmo-error" message={errorKey ? t(errorKey, locale) : null} />
        <section aria-labelledby="hmo-history" className="space-y-1">
          <h3 id="hmo-history" className="font-medium">{t("hmo.history.title", locale)}</h3>
          {(checks.data ?? []).length === 0 ? (
            <p className={MUTED}>{t("hmo.history.empty", locale)}</p>
          ) : (
            <ul className="divide-y">
              {(checks.data ?? []).map((c) => (
                <li key={c.check_id} className="flex justify-between gap-3 py-2">
                  <span>{c.hmo_name}</span>
                  <span className={MUTED}>{t(RESULT_KEYS[c.result], locale)} {formatPatientDate(c.decided_at ?? c.checked_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
