"use client";

import { useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-error";
import { useSetMyPlusState } from "@/lib/queries/commerce";
import { PlusStatePicker } from "./plus-state-picker";

const ERROR_KEYS: Record<string, MessageKey> = {
  plus_state_not_available: "shop.error.plus_state_not_available",
  plus_state_already_set: "shop.plus.state.already_set",
};

function errorKey(error: unknown): MessageKey {
  const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  for (const [code, key] of Object.entries(ERROR_KEYS)) if (message.includes(code)) return key;
  return "shop.plus.state.set_error";
}

/**
 * Membership Plus that arrived without a checkout (an employer seat, an earlier grant) has no collection state yet. The member chooses
 * once from the approved list; the database refuses a later change, the same rule as a state chosen at checkout (OQ-PLUS-1).
 */
export function PlusStateSetup({ locale }: { locale: Locale }) {
  const [state, setState] = useState("");
  const save = useSetMyPlusState();
  return (
    <section aria-labelledby="plus-state-setup" className="space-y-2">
      <h2 id="plus-state-setup" className="font-heading text-lg font-semibold">{t("shop.plus.state.set_title", locale)}</h2>
      <PlusStatePicker id="plus-state-setup-select" value={state} locale={locale} onChange={setState} />
      <FormError id="plus-state-setup-error" message={save.isError ? t(errorKey(save.error), locale) : null} />
      <Button type="button" onClick={() => save.mutate(state)} disabled={!state || save.isPending}>
        {save.isPending ? t("shop.plus.state.set_saving", locale) : t("shop.plus.state.set_button", locale)}
      </Button>
    </section>
  );
}
