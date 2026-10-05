"use client";

import { useEffect, useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { DEFAULT_SETTINGS, normaliseTime, validateSettings, type NotificationSettingsValue } from "@tarragon/shared";
import { loadNotificationSettings, saveNotificationSettings } from "@/lib/queries/notification-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Quiet hours and discreet mode (S13, spec 1.16). Quiet hours hold routine push and email until they end; urgent
 * messages and the in-app inbox are never held. Discreet mode sends fixed words with no app name. There is deliberately
 * no switch to show details on a lock screen: on a shared phone that would be a risk, not a convenience.
 */
export function DeliveryPrivacyCard({ profileId, locale }: { profileId: string; locale: Locale }) {
  const [value, setValue] = useState<NotificationSettingsValue>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    loadNotificationSettings(profileId).then((v) => {
      if (live) {
        setValue(v);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, [profileId]);

  async function save() {
    setMessage(null);
    if (validateSettings(value) !== null) {
      setMessage(t("notif.settings.error_times", locale));
      return;
    }
    setSaving(true);
    const ok = await saveNotificationSettings({
      ...value,
      quietStart: normaliseTime(value.quietStart) ?? value.quietStart,
      quietEnd: normaliseTime(value.quietEnd) ?? value.quietEnd,
    });
    setSaving(false);
    setMessage(t(ok ? "notif.settings.saved" : "notif.settings.error_save", locale));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("notif.settings.quiet_title", locale)}</CardTitle>
        <CardDescription>{t("notif.settings.quiet_body", locale)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={value.quietEnabled}
            disabled={!loaded}
            onChange={(e) => setValue({ ...value, quietEnabled: e.target.checked })}
          />
          {t("notif.settings.quiet_on", locale)}
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            <span className="block">{t("notif.settings.quiet_from", locale)}</span>
            <input
              type="time"
              className="mt-1 rounded border px-2 py-1"
              value={value.quietStart}
              disabled={!loaded || !value.quietEnabled}
              onChange={(e) => setValue({ ...value, quietStart: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="block">{t("notif.settings.quiet_to", locale)}</span>
            <input
              type="time"
              className="mt-1 rounded border px-2 py-1"
              value={value.quietEnd}
              disabled={!loaded || !value.quietEnabled}
              onChange={(e) => setValue({ ...value, quietEnd: e.target.value })}
            />
          </label>
        </div>
        <div>
          <p className="text-sm font-medium">{t("notif.settings.discreet_title", locale)}</p>
          <p className="text-sm text-muted-foreground">{t("notif.settings.discreet_body", locale)}</p>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.discreet}
              disabled={!loaded}
              onChange={(e) => setValue({ ...value, discreet: e.target.checked })}
            />
            {t("notif.settings.discreet_on", locale)}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{t("notif.settings.lockscreen_note", locale)}</p>
        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={!loaded || saving}>
            {t("notif.settings.save", locale)}
          </Button>
          {message && (
            <span role="status" className="text-sm">
              {message}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
