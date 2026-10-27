import { z } from "zod";

/** Reads the W-01 aggregate. Rows are by kind of work and membership only; there is deliberately no clinician field. */
const rowSchema = z.object({
  source: z.enum(["task", "consult", "message", "manual"]),
  tier: z.string(),
  members: z.number(),
  median_minutes: z.number().nullable(),
  p90_minutes: z.number().nullable(),
  total_minutes: z.number(),
});

export type MemberMonthMinutesRow = z.infer<typeof rowSchema>;

/** Null when the answer is not the expected shape, so the page says it could not load rather than showing an empty table. */
export function parseMemberMonthMinutes(data: unknown): MemberMonthMinutesRow[] | null {
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) return null;
  // A fixed order by kind of work and membership (never by a figure about a person).
  const order = ["consult", "task", "message", "manual"];
  return [...parsed.data].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source) || a.tier.localeCompare(b.tier));
}

const SOURCE: Record<MemberMonthMinutesRow["source"], string> = {
  consult: "Consultations",
  task: "Tasks",
  message: "Messages",
  manual: "Added by hand",
};

export const sourceLabel = (s: MemberMonthMinutesRow["source"]): string => SOURCE[s];
export const tierLabel = (tier: string): string => (tier === "plus" ? "Membership Plus" : tier === "evergreen" ? "Membership" : tier);
