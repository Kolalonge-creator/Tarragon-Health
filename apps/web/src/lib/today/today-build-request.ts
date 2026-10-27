import { z } from "zod";
import { buildToday, parseHomeCardConfig, type HomeCardConfig, type TodayFacts, type TodayPlan } from "@tarragon/clinical/today";

const count = z.number().int().min(0).max(10_000);
const word = z.string().min(1).max(60);

/** What the phone knows today. A slot it could not read is null, which hides the card. Counts only: no reading value ever travels here. */
export const todayFactsSchema = z.object({
  goals: z.array(word).max(50),
  pathways: z.array(word).max(50),
  hasDevice: z.boolean(),
  task: z.object({ openCount: count, overdueCount: count }).nullable(),
  medicines: z.object({ pendingCount: count }).nullable(),
  readings: z.object({ loggedToday: z.boolean() }).nullable(),
  goal: z.object({ metToday: z.boolean() }).nullable(),
  lesson: z.object({ available: z.boolean() }).nullable(),
  assistantNudge: z.object({ available: z.boolean() }).nullable(),
  streak: z.object({ available: z.boolean() }).nullable(),
  weekly: z.object({ available: z.boolean() }).nullable(),
  readiness: z.object({ available: z.boolean() }).nullable(),
});

export type TodayBuildAnswer = { state: "hidden" } | { state: "ready"; plan: TodayPlan };

/** The server fallback for `today-build`: the same pure function the phone runs, over the signed configuration. Hidden until it is signed. */
export function answerTodayBuild(configRow: unknown, facts: TodayFacts): TodayBuildAnswer {
  const row = configRow as { version?: unknown; config?: unknown } | null;
  if (!row || typeof row.version !== "number" || !row.config) return { state: "hidden" };
  let config: HomeCardConfig;
  try {
    config = parseHomeCardConfig(row.version, row.config);
  } catch {
    return { state: "hidden" };
  }
  return { state: "ready", plan: buildToday(config, facts) };
}
