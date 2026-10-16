"use client";

import { useState } from "react";
import { isValidSharedPhonePin } from "@tarragon/shared";
import { useSharedPhone } from "@/lib/mental-health/shared-phone";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** The shared-phone switch, the optional PIN, and the always-available Hide now. */
export function SharedPhoneSettings() {
  const { on, hasPin, hidden, setOn, setPin, clearPin, hideNow } = useSharedPhone();
  const [pin, setPinText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("mood.shared.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        <p>
          {t("mood.shared.body")}
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-4 w-4" />
          {t("mood.shared.keep_hidden")}
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="shared-phone-new-pin" className="text-xs">{hasPin ? t("mood.shared.pin_change") : t("mood.shared.pin_new")}</label>
            <input
              id="shared-phone-new-pin"
              inputMode="numeric"
              autoComplete="off"
              type="password"
              value={pin}
              onChange={(e) => setPinText(e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="block w-32 rounded-md border border-charcoal-ink/20 dark:border-night-ink/25 bg-transparent px-2 py-1.5 text-sm"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!isValidSharedPhonePin(pin)) return setMessage(t("mood.shared.pin_invalid"));
              setMessage((await setPin(pin)) ? t("mood.shared.pin_saved") : t("mood.shared.pin_failed"));
              setPinText("");
            }}
          >
            {t("mood.shared.save_pin")}
          </Button>
          {hasPin && (
            <Button type="button" variant="outline" size="sm" onClick={() => { clearPin(); setMessage(t("mood.shared.pin_removed")); }}>
              {t("mood.shared.remove_pin")}
            </Button>
          )}
          {!hidden && (
            <Button type="button" size="sm" onClick={hideNow}>
              {t("mood.shared.hide_now")}
            </Button>
          )}
        </div>
        {message && <p role="status" className="text-xs">{message}</p>}
        <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">
          {t("mood.shared.pin_note")}
        </p>
      </CardContent>
    </Card>
  );
}
