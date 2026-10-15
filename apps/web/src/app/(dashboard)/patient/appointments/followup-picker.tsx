"use client";

import { useActionState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { askForLongerCall, pickSlot, type PickState } from "./followup-actions";

export interface PickerSlot {
  slotId: string;
  label: string;
}

export function SlotPicker({ slots, minutes, locale = "en" }: { slots: PickerSlot[]; minutes: number; locale?: Locale }) {
  const [state, action, pending] = useActionState<PickState, FormData>(pickSlot, undefined);
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-charcoal-ink/70">{t("followups.patient.length", locale, { minutes })}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ask_longer" className="h-4 w-4" />
        <span>{t("followups.patient.longer", locale)}</span>
      </label>
      <ul className="space-y-2">
        {slots.map((s) => (
          <li key={s.slotId}>
            <Button type="submit" name="slot_id" value={s.slotId} variant="outline" disabled={pending} className="w-full justify-between sm:w-auto">
              <span>{s.label}</span>
              <span className="ml-3 text-brand-green">{pending ? t("followups.patient.choosing", locale) : t("followups.patient.choose", locale)}</span>
            </Button>
          </li>
        ))}
      </ul>
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

export function AskLongerForm({ encounterId, locale = "en" }: { encounterId: string; locale?: Locale }) {
  const [state, action, pending] = useActionState<PickState, FormData>(askForLongerCall, undefined);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="encounter_id" value={encounterId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {t("followups.patient.ask_longer", locale)}
      </Button>
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
