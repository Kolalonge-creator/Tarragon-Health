"use client";

import { useState } from "react";
import {
  NOTIFICATION_PREFERENCE_CATEGORIES,
  useNotificationPreferences,
  useUpdateNotificationPreference,
  type NotificationPreferenceCategory,
  type PatientNotificationPreferenceRow,
} from "@/lib/queries/notification-preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CATEGORY_LABEL: Record<NotificationPreferenceCategory, string> = {
  appointments: "Appointment reminders",
  medications: "Medication reminders",
  labs_results: "Lab & test results",
  screenings_vaccinations: "Screening & vaccination reminders",
  referrals: "Referral updates",
  care_messages: "Messages from your care team",
  education_wellness: "Health education & wellness",
  billing: "Billing & payments",
};

type Channel = "email" | "sms" | "push" | "whatsapp";

const CHANNELS: { key: Channel; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "sms", label: "SMS" },
  { key: "push", label: "Push" },
  { key: "whatsapp", label: "WhatsApp" },
];

/** A missing row for a category means every channel defaults on — matches
 * the table's own column defaults, so the read path never needs to
 * pre-create 8 rows per patient. */
const ALL_CHANNELS_ON: Record<Channel, boolean> = {
  email: true,
  sms: true,
  push: true,
  whatsapp: true,
};

function togglesFromRow(
  row: PatientNotificationPreferenceRow | undefined
): Record<Channel, boolean> {
  if (!row) return ALL_CHANNELS_ON;
  return {
    email: row.email_enabled,
    sms: row.sms_enabled,
    push: row.push_enabled,
    whatsapp: row.whatsapp_enabled,
  };
}

export function NotificationPreferencesForm({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: rows, isLoading } = useNotificationPreferences(patientId);
  const updatePreference = useUpdateNotificationPreference();
  const [justSaved, setJustSaved] = useState<NotificationPreferenceCategory | null>(null);

  const rowsByCategory = new Map<NotificationPreferenceCategory, PatientNotificationPreferenceRow>(
    (rows ?? []).map((row) => [row.category, row])
  );

  function handleToggle(
    category: NotificationPreferenceCategory,
    channel: Channel,
    nextValue: boolean
  ) {
    const current = togglesFromRow(rowsByCategory.get(category));
    const next = { ...current, [channel]: nextValue };
    setJustSaved(null);
    updatePreference.mutate(
      {
        patientId,
        organisationId,
        category,
        emailEnabled: next.email,
        smsEnabled: next.sms,
        pushEnabled: next.push,
        whatsappEnabled: next.whatsapp,
      },
      {
        onSuccess: () => {
          setJustSaved(category);
          window.setTimeout(() => {
            setJustSaved((current) => (current === category ? null : current));
          }, 1800);
        },
      }
    );
  }

  return (
    <div className="space-y-6">
      <PriorityLegend />
      <div className="space-y-4">
        {NOTIFICATION_PREFERENCE_CATEGORIES.map((category) => {
          const toggles = togglesFromRow(rowsByCategory.get(category));
          const isSavingThis =
            updatePreference.isPending && updatePreference.variables?.category === category;
          const isSavedFlash = !isSavingThis && justSaved === category;

          return (
            <Card key={category}>
              <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
                <CardTitle className="text-base">{CATEGORY_LABEL[category]}</CardTitle>
                <div className="h-4 text-xs">
                  {isSavingThis && <span className="text-charcoal-ink/50">Saving…</span>}
                  {isSavedFlash && <span className="font-medium text-brand-green">Saved</span>}
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-x-6 gap-y-3 pt-0">
                {CHANNELS.map(({ key, label }) => (
                  <ToggleField
                    key={key}
                    label={label}
                    checked={toggles[key]}
                    disabled={isLoading}
                    onChange={(value) => handleToggle(category, key, value)}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-charcoal-ink">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-brand-green" : "bg-charcoal-ink/20"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-4"
          )}
        />
      </button>
      {label}
    </label>
  );
}

/** Spec §76.13 — explains the Critical/Important/Routine priority model.
 * Explanatory copy only: the actual split lives in the notification bell's
 * own display logic (a separate task), and Critical is not a DB-backed
 * toggle anywhere — it can't be, since a patient must never be able to mute
 * a clinical safety alert. */
function PriorityLegend() {
  return (
    <Card variant="soft">
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-medium text-charcoal-ink">
          How your notifications are prioritised
        </p>
        <ul className="space-y-2 text-sm text-charcoal-ink/70">
          <li className="flex items-start gap-2">
            <Badge variant="red" className="mt-0.5 shrink-0">
              Critical
            </Badge>
            <span>
              Clinical safety alerts, like an abnormal result or an emergency. Always reaches you
              in the app and can&apos;t be turned off.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge variant="amber" className="mt-0.5 shrink-0">
              Important
            </Badge>
            <span>
              Appointments, medications, and referrals. On by default below, and you can adjust
              them.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Badge variant="grey" className="mt-0.5 shrink-0">
              Routine
            </Badge>
            <span>
              Health education and wellness content. The easiest ones to turn down if you&apos;d
              like fewer notifications.
            </span>
          </li>
        </ul>
        <p className="text-xs text-charcoal-ink/50">
          Critical health alerts always reach you in the app, regardless of these settings.
        </p>
      </CardContent>
    </Card>
  );
}
