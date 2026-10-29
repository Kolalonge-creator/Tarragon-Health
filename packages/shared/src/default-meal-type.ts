export type DefaultMealType = "breakfast" | "lunch" | "dinner" | "snack";

/**
 * The meal a person is most likely logging, from the Lagos hour (UTC+1, no daylight saving). Only a starting choice: the person changes it with
 * one tap. One definition for the web and the phone so the windows can never drift apart.
 */
export function defaultMealType(now: Date = new Date()): DefaultMealType {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }).format(now)) % 24;
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 18 && hour < 22) return "dinner";
  return "snack";
}
