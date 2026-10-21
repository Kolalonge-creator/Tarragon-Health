"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { t, type Locale } from "@tarragon/i18n";

/**
 * Saving the emergency card as a lock-screen picture (LSI-1). Shown only when the person has switched the lock-screen option on (off by default).
 * The link is withheld until they tick that anyone holding the phone can read the picture; the route also refuses without `confirm=1`.
 */
export function lockScreenImageHref(opts: { minimum: boolean; qr: boolean }): string {
  const q = new URLSearchParams({ confirm: "1", minimum: opts.minimum ? "1" : "0", qr: opts.qr ? "1" : "0" });
  return `/api/patient/emergency-card/lock-screen-image?${q.toString()}`;
}

export function LockScreenImageCard({ locale = "en" }: { locale?: Locale }) {
  const [confirmed, setConfirmed] = useState(false);
  const [minimum, setMinimum] = useState(true);
  const [qr, setQr] = useState(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("lsi.title", locale)}</CardTitle>
        <CardDescription>{t("lsi.intro", locale)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {t("lsi.warning", locale)}
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-green" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{t("lsi.confirm", locale)}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-green" checked={minimum} onChange={(e) => setMinimum(e.target.checked)} />
          <span>{t("lsi.minimum", locale)}</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-green" checked={qr} onChange={(e) => setQr(e.target.checked)} />
          <span>{t("lsi.qr", locale)}</span>
        </label>
        {confirmed ? (
          <a
            href={lockScreenImageHref({ minimum, qr })}
            download
            className="inline-flex h-10 items-center rounded-lg bg-brand-green px-4 text-sm font-medium text-white"
          >
            {t("lsi.download", locale)}
          </a>
        ) : (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("lsi.needs_confirm", locale)}</p>
        )}
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("lsi.how_to", locale)}</p>
      </CardContent>
    </Card>
  );
}
