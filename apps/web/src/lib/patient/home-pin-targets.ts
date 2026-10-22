import type { LucideIcon } from "lucide-react";
import type { HomePinKey } from "@tarragon/shared";
import { NAV_ICON, SEMANTIC_ICON } from "@/lib/icons";

/** Where tapping a pinned tile goes. Typed as a full Record so a new pin key cannot ship without a destination. */
export const HOME_PIN_HREF: Record<HomePinKey, string> = {
  bp: "/patient/vitals",
  glucose: "/patient/vitals",
  weight: "/patient/weight",
  pulse: "/patient/vitals",
  spo2: "/patient/vitals",
  temperature: "/patient/vitals",
  waist: "/patient/vitals",
  peak_flow: "/patient/vitals",
  active_meds: "/patient/medications",
  doses_today: "/patient/medications",
  sleep: "/patient/sleep",
  meals: "/patient/nutrition",
  exercise: "/patient/exercise",
  symptoms: "/patient/symptom-journal",
  mood: "/patient/wellbeing",
  labs: "/patient/labs",
  appointments: "/patient/appointments",
  screenings: "/patient/prevention",
  messages: "/patient/messages",
};

export const HOME_PIN_ICON: Record<HomePinKey, LucideIcon> = {
  bp: SEMANTIC_ICON.bp,
  glucose: SEMANTIC_ICON.diabetes,
  weight: SEMANTIC_ICON.weight,
  pulse: SEMANTIC_ICON.pulse,
  spo2: SEMANTIC_ICON.spo2,
  temperature: SEMANTIC_ICON.temperature,
  waist: SEMANTIC_ICON.weight,
  peak_flow: SEMANTIC_ICON.spo2,
  active_meds: SEMANTIC_ICON.medication,
  doses_today: SEMANTIC_ICON.preventive,
  sleep: SEMANTIC_ICON.sleep,
  meals: SEMANTIC_ICON.food,
  exercise: SEMANTIC_ICON.workout,
  symptoms: SEMANTIC_ICON.carePlan,
  mood: SEMANTIC_ICON.mood,
  labs: SEMANTIC_ICON.labs,
  appointments: SEMANTIC_ICON.booking,
  screenings: SEMANTIC_ICON.preventive,
  messages: NAV_ICON.messages,
};
