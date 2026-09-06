"use client";

import { useState } from "react";
import Link from "next/link";
import {
  usePatientReminderGroups,
  useCreatePatientReminderGroup,
  useAddPatientsToGroup,
  useSetPatientReminderFrequency,
  useSetGroupReminderFrequency,
} from "@/lib/queries/patient-reminder-groups";
import { setReminderFrequencySchema } from "@/lib/validation/patient-reminder-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Patient = {
  id: string;
  full_name: string | null;
  patient_number: string | null;
  phone: string | null;
};

type FrequencyPreset = "weekly" | "every_3_days" | "custom";

/**
 * Clinician-facing "select patients → set reading-entry reminder frequency"
 * flow (spec §1.3). Overrides the programme default from
 * vitals_reminder_weekly_default.sql for the selected patient(s), either as
 * a one-off per-patient override or saved as a reusable named group.
 */
export function ReminderFrequencySelector({ patients }: { patients: Patient[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [preset, setPreset] = useState<FrequencyPreset>("weekly");
  const [customDays, setCustomDays] = useState("");
  const [groupMode, setGroupMode] = useState<"apply_once" | "existing" | "new">("apply_once");
  const [existingGroupId, setExistingGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const { data: groups } = usePatientReminderGroups();
  const createGroup = useCreatePatientReminderGroup();
  const addPatients = useAddPatientsToGroup();
  const setPatientFrequency = useSetPatientReminderFrequency();
  const setGroupFrequency = useSetGroupReminderFrequency();

  const isSaving =
    createGroup.isPending || addPatients.isPending || setPatientFrequency.isPending || setGroupFrequency.isPending;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resolveFrequencyDays(): number | null {
    const raw = preset === "weekly" ? "7" : preset === "every_3_days" ? "3" : customDays;
    const parsed = setReminderFrequencySchema.safeParse({ frequency_days: raw });
    return parsed.success ? parsed.data.frequency_days : null;
  }

  async function handleSave() {
    setError(null);
    setSavedMessage(null);
    const frequencyDays = resolveFrequencyDays();
    if (frequencyDays === null) {
      setError("Enter a frequency between 1 and 90 days");
      return;
    }
    const patientIds = [...selected];
    if (patientIds.length === 0) {
      setError("Select at least one patient");
      return;
    }

    try {
      if (groupMode === "apply_once") {
        for (const patientId of patientIds) {
          await setPatientFrequency.mutateAsync({ patientId, frequencyDays });
        }
        setSavedMessage(`Frequency set for ${patientIds.length} patient${patientIds.length > 1 ? "s" : ""}.`);
      } else if (groupMode === "existing") {
        if (!existingGroupId) {
          setError("Choose a group");
          return;
        }
        await addPatients.mutateAsync({ groupId: existingGroupId, patientIds });
        await setGroupFrequency.mutateAsync({ groupId: existingGroupId, frequencyDays });
        setSavedMessage(`Added ${patientIds.length} patient(s) to the group and updated its frequency.`);
      } else {
        if (!newGroupName.trim()) {
          setError("Name the new group");
          return;
        }
        const groupId = await createGroup.mutateAsync({ name: newGroupName });
        await addPatients.mutateAsync({ groupId, patientIds });
        await setGroupFrequency.mutateAsync({ groupId, frequencyDays });
        setSavedMessage(`Created "${newGroupName}" with ${patientIds.length} patient(s).`);
        setNewGroupName("");
      }
      setSelected(new Set());
      setPanelOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the reminder frequency");
    }
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-charcoal-ink/10">
        {patients.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <input
              type="checkbox"
              aria-label={`Select ${p.full_name ?? "patient"}`}
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
              className="h-4 w-4 shrink-0 rounded border-charcoal-ink/30 text-brand-green focus:ring-brand-green"
            />
            <Link
              href={`/clinician/patients/${p.id}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-3 hover:bg-charcoal-ink/2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-charcoal-ink">
                  {p.full_name ?? "Unnamed patient"}
                </span>
                <span className="block text-xs text-charcoal-ink/50">
                  {p.patient_number ?? "No patient number"}
                  {p.phone ? ` · ${p.phone}` : ""}
                </span>
              </span>
              <span aria-hidden className="text-charcoal-ink/30">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {selected.size > 0 && (
        <div className="sticky bottom-4 rounded-lg border border-brand-green/30 bg-white p-3 shadow-md">
          {!panelOpen ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-charcoal-ink">
                {selected.size} patient{selected.size > 1 ? "s" : ""} selected
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button size="sm" onClick={() => setPanelOpen(true)}>
                  Set reminder frequency
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm font-medium text-charcoal-ink">
                Reading-entry reminder frequency for {selected.size} patient
                {selected.size > 1 ? "s" : ""}
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex gap-2">
                  {(
                    [
                      ["weekly", "Weekly"],
                      ["every_3_days", "Every 3 days"],
                      ["custom", "Custom"],
                    ] as [FrequencyPreset, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPreset(value)}
                      className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
                        preset === value
                          ? "border-brand-green bg-brand-green/10 text-deep-forest"
                          : "border-charcoal-ink/15 text-charcoal-ink/70 hover:text-charcoal-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {preset === "custom" && (
                  <div className="flex items-end gap-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="custom-days">Every</Label>
                      <Input
                        id="custom-days"
                        type="number"
                        min={1}
                        max={90}
                        value={customDays}
                        onChange={(e) => setCustomDays(e.target.value)}
                        className="w-20"
                      />
                    </div>
                    <span className="pb-2 text-sm text-charcoal-ink/60">days</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap gap-3 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="group-mode"
                      checked={groupMode === "apply_once"}
                      onChange={() => setGroupMode("apply_once")}
                    />
                    Apply to selected patients only
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="group-mode"
                      checked={groupMode === "existing"}
                      onChange={() => setGroupMode("existing")}
                    />
                    Add to an existing group
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="group-mode"
                      checked={groupMode === "new"}
                      onChange={() => setGroupMode("new")}
                    />
                    Save as a new group
                  </label>
                </div>

                {groupMode === "existing" && (
                  <select
                    value={existingGroupId}
                    onChange={(e) => setExistingGroupId(e.target.value)}
                    className="w-full max-w-xs rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Choose a group…</option>
                    {(groups ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.member_count})
                      </option>
                    ))}
                  </select>
                )}

                {groupMode === "new" && (
                  <Input
                    placeholder="e.g. Newly titrated, high risk"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    className="max-w-xs"
                  />
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {savedMessage && <p className="text-sm text-brand-green">{savedMessage}</p>}

              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPanelOpen(false)} disabled={isSaving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
