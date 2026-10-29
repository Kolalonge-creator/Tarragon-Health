import type { MEAL_TYPES } from "@/lib/validation/nutrition";

type MealType = (typeof MEAL_TYPES)[number];

/** The meal a person is most likely logging, from the Lagos hour. Only a starting choice: the person can change it with one tap. */
export function defaultMealType(now: Date = new Date()): MealType {
  const hour =
    Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        hour12: false,
      }).format(now),
    ) % 24;
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 18 && hour < 22) return "dinner";
  return "snack";
}

/** Matches the `meal-photos` bucket (10 MB; jpeg, png, webp, heic). Checked before upload so the person gets a clear message, not a storage error. */
export const MEAL_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const MEAL_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export function mealPhotoProblem(file: {
  size: number;
  type: string;
}): string | null {
  if (file.type && !(MEAL_PHOTO_TYPES as readonly string[]).includes(file.type))
    return "Please choose a JPEG, PNG, WebP or HEIC photo.";
  if (file.size > MEAL_PHOTO_MAX_BYTES)
    return "That photo is over 10 MB. Try a smaller one, or take it again.";
  return null;
}
