import {
  loadActivityState,
  loadAlcoholState,
  loadSleepState,
  loadSmokingState,
  logActivity,
  logAlcohol,
  logSleep,
  logSmoking,
  type ActivityState,
  type AlcoholState,
  type SleepState,
  type SmokingState,
  loadMealsState,
  logMeal,
  type MealsState,
  type MealType,
} from "@/lib/lifestyle-trackers";
import { LifestyleTrackerScreen } from "@/screens/sections/lifestyle-tracker-screen";

/**
 * The four daily lifestyle trackers as native screens, each a thin
 * configuration of the shared shell. See lifestyle-tracker-screen.tsx for why
 * they share one component, and lib/lifestyle-trackers.ts for why sleep alone
 * writes through the server.
 *
 * Copy is deliberately plain: "How long did you sleep?", not "Sleep duration
 * (hours)". These are daily-use screens for people who are not filling in a
 * clinical form.
 */

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Africa/Lagos",
  });
}

function num(values: Record<string, string>, key: string): number | undefined {
  const raw = values[key]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function SleepScreen({ patientId }: { patientId: string }) {
  return (
    <LifestyleTrackerScreen<SleepState>
      config={{
        title: "Sleep",
        blurb: "Log how you slept. Over a few weeks this shows a pattern you and your care team can see.",
        fields: [
          { key: "hours", label: "How long did you sleep?", hint: "Hours, like 7.5", keyboard: "numeric", required: true },
          { key: "quality", label: "How was it, 1 to 5?", hint: "1 is poor, 5 is great", keyboard: "numeric" },
          { key: "sleepy", label: "How sleepy were you in the day, 1 to 5?", hint: "Optional", keyboard: "numeric" },
        ],
        submitLabel: "Save tonight's sleep",
        load: () => loadSleepState(patientId),
        submit: async (values) => {
          const hours = num(values, "hours");
          if (hours === undefined) return { error: "Enter how many hours you slept." };
          return logSleep({
            durationHours: hours,
            qualityRating: num(values, "quality"),
            daytimeSleepiness: num(values, "sleepy"),
          });
        },
        summary: (s) =>
          s.goal?.targetDurationHours
            ? { label: "Your target", value: `${s.goal.targetDurationHours} hours` }
            : s.entries[0]?.durationHours != null
              ? { label: "Last night", value: `${s.entries[0].durationHours} hours` }
              : null,
        history: (s) =>
          s.entries.map((e) => ({
            id: e.loggedOn,
            title: e.durationHours != null ? `${e.durationHours} hours` : "Logged",
            subtitle: [dayLabel(e.loggedOn), e.qualityRating != null ? `quality ${e.qualityRating}/5` : null]
              .filter(Boolean)
              .join(" · "),
          })),
        emptyHistory: "Nothing logged yet. Tonight is a good place to start.",
      }}
    />
  );
}

export function AlcoholScreen({ patientId }: { patientId: string }) {
  return (
    <LifestyleTrackerScreen<AlcoholState>
      config={{
        title: "Alcohol",
        blurb: "Keep a simple count of what you drink. No judgement, just the number.",
        fields: [
          { key: "drinks", label: "How many drinks today?", hint: "A number, like 2", keyboard: "numeric", required: true },
          { key: "context", label: "Anything worth noting?", hint: "Optional, like: with friends" },
        ],
        submitLabel: "Save today",
        load: () => loadAlcoholState(patientId),
        submit: async (values) => {
          const drinks = num(values, "drinks");
          if (drinks === undefined) return { error: "Enter how many drinks." };
          return logAlcohol(patientId, drinks, values.context?.trim() || undefined);
        },
        summary: (s) => ({
          label: "This week",
          value:
            s.targetDrinksPerWeek != null
              ? `${s.drinksThisWeek} of ${s.targetDrinksPerWeek}`
              : `${s.drinksThisWeek} drinks`,
        }),
        history: (s) =>
          s.entries.map((e) => ({
            id: e.loggedOn,
            title: `${e.drinks} ${e.drinks === 1 ? "drink" : "drinks"}`,
            subtitle: [dayLabel(e.loggedOn), e.context].filter(Boolean).join(" · "),
          })),
        emptyHistory: "Nothing logged yet.",
      }}
    />
  );
}

export function SmokingScreen({ patientId }: { patientId: string }) {
  return (
    <LifestyleTrackerScreen<SmokingState>
      config={{
        title: "Smoking",
        blurb: "Check in on how the day went. Cravings count too, even on a day you did not smoke.",
        fields: [
          { key: "cigarettes", label: "How many cigarettes today?", hint: "0 is a good answer", keyboard: "numeric", required: true },
          { key: "cravings", label: "How strong were the cravings, 1 to 5?", hint: "Optional", keyboard: "numeric" },
        ],
        submitLabel: "Save today",
        load: () => loadSmokingState(patientId),
        submit: async (values) => {
          const cigarettes = num(values, "cigarettes");
          if (cigarettes === undefined) return { error: "Enter a number, even if it is 0." };
          return logSmoking(patientId, cigarettes, num(values, "cravings"));
        },
        summary: (s) =>
          s.quitDate
            ? { label: "Quit date", value: dayLabel(s.quitDate) }
            : s.cigarettesPerDay != null
              ? { label: "Usual day", value: `${s.cigarettesPerDay} a day` }
              : null,
        history: (s) =>
          s.entries.map((e) => ({
            id: e.loggedOn,
            title: e.cigarettes != null ? `${e.cigarettes} cigarettes` : "Checked in",
            subtitle: [dayLabel(e.loggedOn), e.cravings != null ? `cravings ${e.cravings}/5` : null]
              .filter(Boolean)
              .join(" · "),
          })),
        emptyHistory: "Nothing logged yet.",
      }}
    />
  );
}

export function ActivityScreen({ patientId }: { patientId: string }) {
  return (
    <LifestyleTrackerScreen<ActivityState>
      config={{
        title: "Movement",
        blurb: "Anything counts: a walk, housework, football. Write what you did and for how long.",
        fields: [
          { key: "name", label: "What did you do?", hint: "Like: walked to the market", required: true },
          { key: "minutes", label: "For how many minutes?", hint: "A number, like 30", keyboard: "numeric", required: true },
        ],
        submitLabel: "Save it",
        load: () => loadActivityState(patientId),
        submit: async (values) => {
          const minutes = num(values, "minutes");
          const name = values.name?.trim();
          if (!name) return { error: "Say what you did." };
          if (minutes === undefined) return { error: "Enter how many minutes." };
          return logActivity(patientId, { activityName: name, durationMinutes: minutes });
        },
        summary: (s) =>
          s.dailyStepGoal != null ? { label: "Daily step goal", value: `${s.dailyStepGoal}` } : null,
        history: (s) =>
          s.entries.map((e, i) => ({
            id: `${e.loggedOn}:${i}`,
            title: e.activityName ?? "Activity",
            subtitle: [
              dayLabel(e.loggedOn),
              e.durationMinutes != null ? `${e.durationMinutes} min` : null,
              e.stepCount != null ? `${e.stepCount} steps` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          })),
        emptyHistory: "Nothing logged yet.",
      }}
    />
  );
}

export function MealsScreen({ patientId }: { patientId: string }) {
  return (
    <LifestyleTrackerScreen<MealsState>
      config={{
        title: "Meals",
        blurb:
          "Write down what you ate. Over time it helps you and your care team see what is working. To add a photo and get a carb estimate, open Meals on the website.",
        fields: [
          {
            key: "mealType",
            label: "Which meal?",
            required: true,
            choices: [
              { value: "breakfast", label: "Breakfast" },
              { value: "lunch", label: "Lunch" },
              { value: "dinner", label: "Dinner" },
              { value: "snack", label: "Snack" },
            ],
          },
          { key: "description", label: "What did you eat?", hint: "Like: jollof rice and chicken", required: true },
        ],
        submitLabel: "Save this meal",
        load: () => loadMealsState(patientId),
        submit: async (values) => {
          const mealType = values.mealType as MealType | undefined;
          const description = values.description?.trim();
          if (!mealType) return { error: "Pick which meal it was." };
          if (!description) return { error: "Write what you ate." };
          return logMeal(patientId, { mealType, description });
        },
        summary: () => null,
        history: (s) =>
          s.entries.map((e) => ({
            id: e.id,
            title: e.description ?? "Meal",
            subtitle: `${e.mealType[0]!.toUpperCase()}${e.mealType.slice(1)} · ${dayLabel(e.loggedAt.slice(0, 10))}`,
          })),
        emptyHistory: "Nothing logged yet. Your next meal is a fine place to start.",
      }}
    />
  );
}
