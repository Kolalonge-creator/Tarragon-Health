"use client";

import { useActionState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotificationPreferences } from "@/lib/queries/notification-preferences";
import {
  setNotificationPreferencesAction,
  type NotificationPreferencesActionState,
} from "./notification-preferences-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CHANNEL_OPTIONS = [
  { value: "in_app", label: "In-app" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "push", label: "Push notification" },
] as const;

const FREQUENCY_OPTIONS = [
  { value: "minimal", label: "Minimal — only what matters" },
  { value: "normal", label: "Normal" },
  { value: "frequent", label: "Frequent — extra encouragement" },
] as const;

/**
 * §16.14 — patient-controlled channel/frequency/quiet-hours preferences.
 * Language isn't offered here: the platform is English-only by founder
 * decision (CLAUDE.md, 2026-08-03). Clinical safety notifications (abnormal
 * results, red-flag vitals) always go out regardless of what's set here —
 * see private.notification_allowed_now, which checks content_class before
 * any of these preferences.
 */
export function NotificationPreferencesForm({ patientId }: { patientId: string }) {
  const queryClient = useQueryClient();
  const prefs = useNotificationPreferences(patientId);
  const [state, formAction] = useActionState<NotificationPreferencesActionState, FormData>(
    async (prev, formData) => {
      const result = await setNotificationPreferencesAction(prev, formData);
      if (result?.success) {
        queryClient.invalidateQueries({ queryKey: ["notification-preferences", patientId] });
      }
      return result;
    },
    undefined
  );

  if (prefs.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notification preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-charcoal-ink/60">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  const p = prefs.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <p className="text-sm text-charcoal-ink/60">
          Choose how and when we reach you. Safety alerts — like an abnormal result or a
          dangerous reading — always come through, no matter what&apos;s set below.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-1">
            <Label htmlFor="preferred_channel">Preferred channel</Label>
            <select
              id="preferred_channel"
              name="preferred_channel"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={p?.preferred_channel ?? "whatsapp"}
            >
              {CHANNEL_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="frequency">How often</Label>
            <select
              id="frequency"
              name="frequency"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              defaultValue={p?.frequency ?? "normal"}
            >
              {FREQUENCY_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="quiet_hours_start">Quiet hours start</Label>
              <Input
                id="quiet_hours_start"
                name="quiet_hours_start"
                type="time"
                defaultValue={p?.quiet_hours_start ?? ""}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="quiet_hours_end">Quiet hours end</Label>
              <Input
                id="quiet_hours_end"
                name="quiet_hours_end"
                type="time"
                defaultValue={p?.quiet_hours_end ?? ""}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Channels to use</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["in_app_enabled", "In-app", p?.in_app_enabled],
                  ["whatsapp_enabled", "WhatsApp", p?.whatsapp_enabled],
                  ["sms_enabled", "SMS", p?.sms_enabled],
                  ["email_enabled", "Email", p?.email_enabled],
                  ["push_enabled", "Push", p?.push_enabled],
                ] as const
              ).map(([name, label, defaultValue]) => (
                <label key={name} className="flex items-center gap-2 text-sm text-charcoal-ink">
                  <input
                    type="checkbox"
                    name={name}
                    defaultChecked={defaultValue ?? true}
                    className="h-4 w-4 rounded border-input"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Saved.</p>}
          <Button type="submit">Save preferences</Button>
        </form>
      </CardContent>
    </Card>
  );
}
