"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useSaveDailyLog,
  type MenstrualDailyLog,
  type MenstrualFlowLevel,
  type MenstrualMood,
  type MenstrualSymptom,
} from "@/lib/queries/menstrual-cycle";

/**
 * The per-day log: flow, symptoms and mood for one date.
 *
 * Tapping is the whole interaction — every field is a toggle, nothing is
 * required, and there is no validation to fail. Somebody logging a headache
 * on a bad day should not meet a form.
 */

export const FLOW_OPTIONS: { value: MenstrualFlowLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "spotting", label: "Spotting" },
  { value: "light", label: "Light" },
  { value: "medium", label: "Medium" },
  { value: "heavy", label: "Heavy" },
  { value: "flooding", label: "Very heavy" },
];

const SYMPTOM_OPTIONS: { value: MenstrualSymptom; label: string }[] = [
  { value: "cramps", label: "Cramps" },
  { value: "headache", label: "Headache" },
  { value: "bloating", label: "Bloating" },
  { value: "breast_tenderness", label: "Sore breasts" },
  { value: "back_pain", label: "Back pain" },
  { value: "fatigue", label: "Tiredness" },
  { value: "nausea", label: "Nausea" },
  { value: "acne", label: "Skin breakout" },
  { value: "diarrhoea", label: "Loose stool" },
  { value: "constipation", label: "Constipation" },
  { value: "food_cravings", label: "Cravings" },
  { value: "insomnia", label: "Trouble sleeping" },
];

const MOOD_OPTIONS: { value: MenstrualMood; label: string }[] = [
  { value: "calm", label: "Calm" },
  { value: "happy", label: "Happy" },
  { value: "energetic", label: "Energetic" },
  { value: "irritable", label: "Irritable" },
  { value: "anxious", label: "Anxious" },
  { value: "low", label: "Low" },
  { value: "mood_swings", label: "Up and down" },
];

function Chip({
  label,
  selected,
  onClick,
  tone = "neutral",
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  tone?: "neutral" | "period";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "rounded-full border px-3 py-1.5 text-xs transition",
        selected
          ? tone === "period"
            ? "border-transparent text-white"
            : "border-transparent bg-brand-green text-white"
          : "border-charcoal-ink/20 text-charcoal-ink hover:bg-charcoal-ink/5",
      ].join(" ")}
      style={
        selected && tone === "period" ? { backgroundColor: "var(--cycle-period)" } : undefined
      }
    >
      {label}
    </button>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function CycleDayLog({
  patientId,
  organisationId,
  date,
  existing,
}: {
  patientId: string;
  organisationId: string;
  date: string;
  existing: MenstrualDailyLog | null;
}) {
  const save = useSaveDailyLog();
  // Seeded once per mount. The parent remounts this component with
  // key={date}, so moving around the calendar shows that day's log rather
  // than the last one edited — which is what a reset-on-prop-change effect
  // would have done, minus the cascading render.
  const [flow, setFlow] = useState<MenstrualFlowLevel | null>(existing?.flow ?? null);
  const [symptoms, setSymptoms] = useState<MenstrualSymptom[]>(existing?.symptoms ?? []);
  const [moods, setMoods] = useState<MenstrualMood[]>(existing?.moods ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const readableDate = new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          patientId,
          organisationId,
          logDate: date,
          flow,
          symptoms,
          moods,
          notes: notes.trim() || null,
        });
      }}
    >
      <p className="text-sm font-medium text-charcoal-ink">{readableDate}</p>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70">Flow</legend>
        <div className="flex flex-wrap gap-2">
          {FLOW_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              tone="period"
              selected={flow === option.value}
              onClick={() => setFlow(flow === option.value ? null : option.value)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70">
          How you felt physically
        </legend>
        <div className="flex flex-wrap gap-2">
          {SYMPTOM_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={symptoms.includes(option.value)}
              onClick={() => setSymptoms((current) => toggle(current, option.value))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70">Mood</legend>
        <div className="flex flex-wrap gap-2">
          {MOOD_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={moods.includes(option.value)}
              onClick={() => setMoods((current) => toggle(current, option.value))}
            />
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="cycle-notes" className="text-xs font-medium text-charcoal-ink/70">
          Anything else (optional)
        </label>
        <Textarea
          id="cycle-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Only you and your care team can see this."
        />
      </div>

      {save.isError && (
        <p className="text-sm text-red-600">
          {(save.error as Error)?.message ?? "Could not save that. Please try again."}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save this day"}
        </Button>
        {save.isSuccess && !save.isPending && (
          <span className="text-xs text-brand-green">Saved</span>
        )}
      </div>
    </form>
  );
}
