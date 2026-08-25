/** Africa/Lagos is a fixed UTC+1 offset with no DST (CLAUDE.md: "Timezone
 * always Africa/Lagos"), so the time-of-day bucket can be computed with plain
 * offset math instead of a timezone database lookup — same approach as
 * lib/ai-coach/lagos-day.ts's day-boundary helper. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export type GreetingWord = "morning" | "afternoon" | "evening";

/** Time-of-day word for a patient-facing greeting, in Africa/Lagos local
 * time regardless of where the server or the reader physically is. */
export function getLagosGreetingWord(now: Date = new Date()): GreetingWord {
  const lagosHour = new Date(now.getTime() + LAGOS_OFFSET_MS).getUTCHours();
  if (lagosHour < 12) return "morning";
  if (lagosHour < 17) return "afternoon";
  return "evening";
}
