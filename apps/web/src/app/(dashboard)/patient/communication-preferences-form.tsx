"use client";

import { useActionState } from "react";
import { updateCommunicationPreferences } from "./communication-preferences-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "No preference (default: app notification, then WhatsApp/SMS as needed)" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "push", label: "App notification" },
];

/**
 * Health Communication Engine — communication preferences (17.15). Only
 * covers ROUTINE reminders/confirmations: a dangerous vitals reading, an
 * abnormal result, or any other clinical/emergency alert always reaches you
 * regardless of what's set here — see the note under Marketing below.
 */
export function CommunicationPreferencesForm({
  initial,
}: {
  initial: { notification_channel_preference: string | null; marketing_opt_in: boolean };
}) {
  const [state, formAction, pending] = useActionState(updateCommunicationPreferences, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.bell className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Communication preferences
        </CardTitle>
        <CardDescription>
          Choose how you&apos;d like routine reminders and confirmations to reach you. This never
          affects clinical or emergency alerts — a dangerous reading or an abnormal result always
          reaches you on every channel we have, regardless of what you choose here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="space-y-1.5">
            <label htmlFor="notification_channel_preference" className="text-sm font-medium text-charcoal-ink">
              Preferred channel for reminders
            </label>
            <select
              id="notification_channel_preference"
              name="notification_channel_preference"
              defaultValue={initial.notification_channel_preference ?? ""}
              className="w-full rounded-lg border border-charcoal-ink/15 px-3 py-2 text-sm"
            >
              {CHANNEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="marketing_opt_in"
              defaultChecked={initial.marketing_opt_in}
              className="mt-0.5"
            />
            <span>
              Send me occasional news and offers from Tarragon Health. This is separate from your
              care reminders — turning it off never affects appointment, medication, or result
              notifications.
            </span>
          </label>

          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Saving…" : "Save preferences"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
