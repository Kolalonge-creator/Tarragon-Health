"use client";

import { useActionState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { extendCall, type ExtendState } from "./actions";

export function ExtendCallForm({ encounterId, steps, locale = "en" }: { encounterId: string; steps: number[]; locale?: Locale }) {
  const [state, action, pending] = useActionState<ExtendState, FormData>(extendCall, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="encounter_id" value={encounterId} />
      <p className="text-sm font-medium text-charcoal-ink">{t("precall.extend_title", locale)}</p>
      <div className="flex flex-wrap gap-2">
        {steps.map((minutes) => (
          <Button key={minutes} type="submit" name="minutes" value={String(minutes)} variant="outline" size="sm" disabled={pending}>
            {t("precall.extend_button", locale, { minutes })}
          </Button>
        ))}
      </div>
      {state?.message && (
        <p role="status" className="text-sm text-brand-green">
          {state.message}
        </p>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
    </form>
  );
}
