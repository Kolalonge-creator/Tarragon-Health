"use client";

import {
  useMedicationReminderPreferences,
  useUpdateMedicationReminderPreferences,
} from "@/lib/queries/medication-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Module 21 §21.13 — patient-configurable dose/missed-dose reminders. */
export function MedicationReminderPreferences({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const { data: prefs } = useMedicationReminderPreferences(patientId);
  const update = useUpdateMedicationReminderPreferences();

  const doseRemindersEnabled = prefs?.dose_reminders_enabled ?? false;
  const missedDosePromptsEnabled = prefs?.missed_dose_prompts_enabled ?? true;

  function set(next: Partial<{ dose_reminders_enabled: boolean; missed_dose_prompts_enabled: boolean }>) {
    update.mutate({
      dose_reminders_enabled: doseRemindersEnabled,
      missed_dose_prompts_enabled: missedDosePromptsEnabled,
      ...next,
      patientId,
      organisationId,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Medication reminders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <label htmlFor="dose-reminders-toggle" className="flex items-center justify-between gap-3">
          <span className="text-xs text-charcoal-ink/70">Remind me at each dose time</span>
          <input
            id="dose-reminders-toggle"
            type="checkbox"
            checked={doseRemindersEnabled}
            onChange={(event) => set({ dose_reminders_enabled: event.target.checked })}
            disabled={update.isPending}
          />
        </label>
        <label htmlFor="missed-dose-toggle" className="flex items-center justify-between gap-3">
          <span className="text-xs text-charcoal-ink/70">Nudge me if I miss a dose</span>
          <input
            id="missed-dose-toggle"
            type="checkbox"
            checked={missedDosePromptsEnabled}
            onChange={(event) => set({ missed_dose_prompts_enabled: event.target.checked })}
            disabled={update.isPending}
          />
        </label>
        {update.isError && <p className="text-xs text-red-600">Could not save your preferences.</p>}
      </CardContent>
    </Card>
  );
}
