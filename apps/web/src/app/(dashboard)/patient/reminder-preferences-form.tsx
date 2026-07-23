"use client";

import { useActionState } from "react";
import { updateReminderPreferences } from "./reminder-preferences-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NAV_ICON } from "@/lib/icons";

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "pcm", label: "Pidgin" },
  { value: "yo", label: "Yorùbá" },
  { value: "ha", label: "Hausa" },
  { value: "ig", label: "Igbo" },
];

/**
 * How reminders reach this patient. The voice option exists for elders (the
 * real ParentCare end user often doesn't read WhatsApp) — queued reminders
 * become a phone call instead. Language applies to reminder messages;
 * translations are being rolled out template by template, falling back to
 * English until each is covered.
 */
export function ReminderPreferencesForm({
  initial,
}: {
  initial: { preferred_reminder_channel: string | null; language: string };
}) {
  const [state, formAction, pending] = useActionState(updateReminderPreferences, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.broadcast className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Reminder preferences
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          <div>
            <label className="text-sm font-medium text-charcoal-ink" htmlFor="reminder-channel">
              How should reminders reach you?
            </label>
            <select
              id="reminder-channel"
              name="channel"
              defaultValue={initial.preferred_reminder_channel ?? ""}
              className="mt-1 block rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
            >
              <option value="">WhatsApp message (default, SMS backup)</option>
              <option value="voice">Phone call — best for parents and elders</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-charcoal-ink" htmlFor="reminder-language">
              Reminder language
            </label>
            <select
              id="reminder-language"
              name="language"
              defaultValue={initial.language}
              className="mt-1 block rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-charcoal-ink/60">
              Applies to reminder messages and calls. Some reminders may still arrive in
              English while we finish translating them.
            </p>
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save preferences"}
          </Button>
          {state?.message && <p className="text-xs text-charcoal-ink/70">{state.message}</p>}
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
