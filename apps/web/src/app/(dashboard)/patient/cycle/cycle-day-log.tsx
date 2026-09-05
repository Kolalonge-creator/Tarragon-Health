"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  useSaveDailyLog,
  type MenstrualDailyLog,
  type MenstrualFlowLevel,
  type MenstrualMood,
  type MenstrualOvulationTestResult,
  type MenstrualSymptom,
} from "@/lib/queries/menstrual-cycle";
import { Input } from "@/components/ui/input";
import { FormError, fieldErrorId, fieldErrorProps } from "@/components/ui/form-error";

import { formatPatientDate } from "@/lib/format-date";
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

const OVULATION_TEST_OPTIONS: { value: MenstrualOvulationTestResult; label: string }[] = [
  { value: "negative", label: "Negative" },
  { value: "positive", label: "Positive" },
  { value: "peak", label: "Peak" },
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
          : "border-charcoal-ink/20 dark:border-night-ink/25 text-charcoal-ink dark:text-night-ink hover:bg-charcoal-ink/5 dark:hover:bg-night-ink/10",
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
  // One message for the day as a whole: the mutation fails or it does not,
  // and nothing here is per-field validated.
  const errorId = fieldErrorId("cycle-day-log");
  // Seeded once per mount. The parent remounts this component with
  // key={date}, so moving around the calendar shows that day's log rather
  // than the last one edited — which is what a reset-on-prop-change effect
  // would have done, minus the cascading render.
  const [flow, setFlow] = useState<MenstrualFlowLevel | null>(existing?.flow ?? null);
  const [symptoms, setSymptoms] = useState<MenstrualSymptom[]>(existing?.symptoms ?? []);
  const [moods, setMoods] = useState<MenstrualMood[]>(existing?.moods ?? []);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [bbt, setBbt] = useState(
    existing?.basal_body_temperature_c != null ? String(existing.basal_body_temperature_c) : ""
  );
  const [ovulationTest, setOvulationTest] = useState<MenstrualOvulationTestResult | null>(
    existing?.ovulation_test_result ?? null
  );

  const readableDate = formatPatientDate(`${date}T00:00:00Z`, {
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
          // Empty string means "not measured", which is a different thing
          // from zero and must not be sent as one.
          basalBodyTemperatureC: bbt.trim() === "" ? null : Number(bbt),
          ovulationTestResult: ovulationTest,
        });
      }}
    >
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{readableDate}</p>

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">Flow</legend>
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
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
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
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">Mood</legend>
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

      {/* Optional, and only meaningful to somebody actively tracking
          ovulation, so it sits after the everyday fields rather than
          greeting everyone who opens the form. */}
      <fieldset>
        <legend className="mb-2 text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          Tracking ovulation? (optional)
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="cycle-bbt" className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Waking temperature (&deg;C)
            </label>
            <Input
              id="cycle-bbt"
              type="number"
              step="0.01"
              min={34}
              max={40}
              inputMode="decimal"
              placeholder="36.50"
              value={bbt}
              onChange={(event) => setBbt(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <span id="cycle-ovulation-test-label" className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Ovulation test
            </span>
            <div role="group" aria-labelledby="cycle-ovulation-test-label" className="flex flex-wrap gap-2">
              {OVULATION_TEST_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  selected={ovulationTest === option.value}
                  onClick={() =>
                    setOvulationTest(ovulationTest === option.value ? null : option.value)
                  }
                />
              ))}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-charcoal-ink/50 dark:text-night-ink/55">
          Take your temperature before getting out of bed. A sustained rise suggests ovulation
          has already happened, so it confirms rather than predicts.
        </p>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="cycle-notes" className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
          Anything else (optional)
        </label>
        <Textarea
          id="cycle-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Only you and your care team can see this."
          {...fieldErrorProps(errorId, save.isError)}
        />
      </div>

      {/* The raw mutation error used to be printed here, which put a
          PostgREST string in front of a patient. Nothing about a failed save
          is per-field, so one human sentence is the whole message. */}
      <FormError id={errorId} message={save.isError && "Could not save that just now. Please try again."} />

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? "Saving..." : "Save this day"}
        </Button>
        {save.isSuccess && !save.isPending && (
          <span className="text-xs text-brand-green dark:text-brand-green-bright">Saved</span>
        )}
      </div>
    </form>
  );
}
