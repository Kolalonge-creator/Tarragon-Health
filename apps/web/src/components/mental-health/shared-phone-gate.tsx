"use client";

import { useState, type ReactNode } from "react";
import { useSharedPhone } from "@/lib/mental-health/shared-phone";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Wraps wellbeing content. While hidden it shows a neutral card that names nothing about the content. */
export function SharedPhoneGate({ children }: { children: ReactNode }) {
  const { hidden, hasPin, show } = useSharedPhone();
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);
  if (!hidden) return <>{children}</>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("mood.shared.gate_title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("mood.shared.gate_body")}</p>
        {hasPin && (
          <div className="space-y-1">
            <label htmlFor="shared-phone-pin" className="text-sm">{t("mood.shared.gate_pin")}</label>
            <input
              id="shared-phone-pin"
              inputMode="numeric"
              autoComplete="off"
              type="password"
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 8)); setWrong(false); }}
              className="block w-32 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm"
              aria-invalid={wrong}
              aria-describedby={wrong ? "shared-phone-pin-error" : undefined}
            />
            {wrong && <p id="shared-phone-pin-error" role="alert" className="text-xs text-red-600 dark:text-red-400">{t("mood.shared.gate_wrong")}</p>}
          </div>
        )}
        <Button
          type="button"
          onClick={async () => {
            const ok = await show(pin);
            if (!ok) setWrong(true);
            else setPin("");
          }}
        >
          {t("mood.shared.gate_show")}
        </Button>
      </CardContent>
    </Card>
  );
}
