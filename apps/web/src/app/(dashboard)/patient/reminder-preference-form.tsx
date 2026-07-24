"use client";

import { useActionState } from "react";
import { updateReminderPreference } from "./reminder-preference-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Lets a patient opt in to a phone call instead of WhatsApp for reminders —
 * built for someone who doesn't read WhatsApp (e.g. a ParentCare elder).
 * Reminders remain notification-layer only either way; this never becomes a
 * required interface for any core action.
 */
export function ReminderPreferenceForm({
  initial,
}: {
  initial: { preferred_reminder_channel: string | null };
}) {
  const [state, formAction, pending] = useActionState(updateReminderPreference, undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.reminderPreference className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Reminder preference
        </CardTitle>
        <CardDescription>
          Choose how you&apos;d like reminders delivered — a WhatsApp message (with SMS as a
          fallback) or a phone call that reads the reminder aloud.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-3">
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="preferred_reminder_channel"
                value="whatsapp"
                defaultChecked={initial.preferred_reminder_channel !== "voice"}
              />
              WhatsApp message (default)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="preferred_reminder_channel"
                value="voice"
                defaultChecked={initial.preferred_reminder_channel === "voice"}
              />
              Phone call
            </label>
          </div>

          <Button type="submit" disabled={pending} size="sm">
            {pending ? "Saving…" : "Save preference"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
