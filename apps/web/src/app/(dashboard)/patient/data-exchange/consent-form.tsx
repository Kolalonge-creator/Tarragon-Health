"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@tarragon/i18n";
import { grantExchangeConsentAction, withdrawExchangeConsentAction } from "./actions";

export function ConsentForm({ locale }: { locale: Locale }) {
  const [source, setSource] = useState("");
  const [direction, setDirection] = useState<"import" | "export" | "both">("import");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await grantExchangeConsentAction({ source, direction });
          setMessage(r.ok ? t("exchange.saved", locale) : t("exchange.failed", locale));
          if (r.ok) setSource("");
        });
      }}
    >
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("exchange.consent_placeholder", locale)}</p>
      <label className="block text-sm font-medium">
        {t("exchange.source_label", locale)}
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          className="mt-1 block w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 py-2 text-base dark:border-night-ink/30"
          aria-describedby="exchange-source-help"
        />
      </label>
      <p id="exchange-source-help" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("exchange.source_help", locale)}</p>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t("exchange.direction_label", locale)}</legend>
        {(["import", "export", "both"] as const).map((d) => (
          <label key={d} className="flex items-center gap-2 text-sm">
            <input type="radio" name="direction" value={d} checked={direction === d} onChange={() => setDirection(d)} />
            {t(`exchange.direction.${d}`, locale)}
          </label>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending || source.trim().length < 2}>{t("exchange.grant", locale)}</Button>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </form>
  );
}

export function WithdrawButton({ id, locale }: { id: string; locale: Locale }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => start(async () => { await withdrawExchangeConsentAction(id); })}>
      {t("exchange.withdraw", locale)}
    </Button>
  );
}
