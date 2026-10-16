"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { saveEmergencyCardFieldsAction } from "@/lib/emergency/actions";
import { CARD_FIELDS, MINIMAL_CHOICES, DEFAULT_CHOICES, type CardFieldChoices } from "@/lib/emergency/field-choices";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

/**
 * The person decides what a stranger can see on their emergency card (S43, spec 2.7).
 * Starts from what the card shows today; "Use the minimum" is one tap. Lock screen
 * presence is its own switch, off unless chosen, with the shared-phone warning beside it.
 */
export function CardFieldsForm({ initial, locale = "en" }: { initial: CardFieldChoices; locale?: Locale }) {
  const [choices, setChoices] = useState<CardFieldChoices>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await saveEmergencyCardFieldsAction(choices);
      if (res.error) setError(t("ecf.error", locale));
      else setMessage(t("ecf.saved", locale));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("ecf.title", locale)}</CardTitle>
        <CardDescription>{t("ecf.description", locale)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CARD_FIELDS.map((f) => (
            <label key={f} className="flex cursor-pointer items-center gap-2 rounded-lg border border-charcoal-ink/10 px-3 py-2 text-sm dark:border-night-ink/15">
              <input type="checkbox" className="h-4 w-4 accent-brand-green" checked={choices[f]} onChange={(e) => setChoices((c) => ({ ...c, [f]: e.target.checked }))} />
              <span>{t(`ecf.field.${f}` as MessageKey, locale)}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setChoices((c) => ({ ...MINIMAL_CHOICES, lock_screen_opt_in: c.lock_screen_opt_in }))}>
            {t("ecf.preset_minimal", locale)}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setChoices((c) => ({ ...DEFAULT_CHOICES, lock_screen_opt_in: c.lock_screen_opt_in }))}>
            {t("ecf.preset_all", locale)}
          </Button>
        </div>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-green" checked={choices.lock_screen_opt_in} onChange={(e) => setChoices((c) => ({ ...c, lock_screen_opt_in: e.target.checked }))} />
            <span>
              <span className="font-medium">{t("ecf.lock_screen", locale)}</span>
              <span className="mt-1 block text-xs text-amber-900 dark:text-amber-200">{t("ecf.lock_screen_help", locale)}</span>
            </span>
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
            {message}
          </p>
        )}
        <Button type="button" onClick={save} disabled={pending}>
          {t("ecf.save", locale)}
        </Button>
      </CardContent>
    </Card>
  );
}
