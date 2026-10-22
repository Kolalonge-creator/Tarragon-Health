import type { HomePinKey } from "@tarragon/shared";
import type { IconName } from "@/ui/kit";
import type { SectionId } from "./sections";

/** Where tapping a pinned tile goes. A full Record, so a new pin key cannot ship without a destination here. */
export const HOME_PIN_SECTION: Record<HomePinKey, SectionId> = {
  bp: "vitals",
  glucose: "vitals",
  weight: "vitals",
  pulse: "vitals",
  spo2: "vitals",
  temperature: "vitals",
  waist: "vitals",
  peak_flow: "vitals",
  active_meds: "medications",
  doses_today: "medications",
  sleep: "sleep",
  meals: "meals",
  exercise: "exercise",
  // "Vitals & symptoms" is one section in the app.
  symptoms: "vitals",
  mood: "wellbeing",
  labs: "labs",
  appointments: "appointments",
  screenings: "prevention",
  messages: "messages",
};

export const HOME_PIN_ICON: Record<HomePinKey, IconName> = {
  bp: "heart",
  glucose: "glucose",
  weight: "weight",
  pulse: "heart",
  spo2: "vitals",
  temperature: "vitals",
  waist: "weight",
  peak_flow: "vitals",
  active_meds: "medication",
  doses_today: "done",
  sleep: "sleep",
  meals: "food",
  exercise: "exercise",
  symptoms: "symptoms",
  mood: "mood",
  labs: "labs",
  appointments: "appointment",
  screenings: "safe",
  messages: "messages",
};
