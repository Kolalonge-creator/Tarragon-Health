import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * Reads the W-01 aggregate. Two kinds of row, both by membership: 'total' (per tier: Members, mean, median and p90 of each Member's TOTAL
 * minutes, zero-minute Members included) and 'source' (total minutes per kind of work, no medians). There is deliberately no clinician field.
 */
const rowSchema = z.object({
  kind: z.enum(["total", "source"]),
  tier: z.string(),
  source: z.enum(["task", "consult", "message", "manual"]).nullable(),
  members: z.number().nullable(),
  mean_minutes: z.number().nullable(),
  median_minutes: z.number().nullable(),
  p90_minutes: z.number().nullable(),
  total_minutes: z.number().nullable(),
});

export type MemberMonthMinutesRow = z.infer<typeof rowSchema>;
export type TimeSource = NonNullable<MemberMonthMinutesRow["source"]>;

const ORDER: TimeSource[] = ["consult", "task", "message", "manual"];

export interface TimeReport {
  totals: MemberMonthMinutesRow[];
  sources: MemberMonthMinutesRow[];
}

/** Null when the answer is not the expected shape, so the page says it could not load rather than showing an empty table. */
export function parseMemberMonthMinutes(data: unknown): TimeReport | null {
  const parsed = z.array(rowSchema).safeParse(data);
  if (!parsed.success) return null;
  // A fixed order by membership and kind of work (never by a figure about a person).
  const rows = [...parsed.data];
  return {
    totals: rows.filter((r) => r.kind === "total").sort((a, b) => a.tier.localeCompare(b.tier)),
    sources: rows
      .filter((r) => r.kind === "source")
      .sort((a, b) => a.tier.localeCompare(b.tier) || ORDER.indexOf(a.source ?? "manual") - ORDER.indexOf(b.source ?? "manual")),
  };
}

const SOURCE_KEY: Record<TimeSource, MessageKey> = {
  task: "time.source.task",
  consult: "time.source.consult",
  message: "time.source.message",
  manual: "time.source.manual",
};

export const sourceLabelKey = (s: TimeSource): MessageKey => SOURCE_KEY[s];
export const tierLabelKey = (tier: string): MessageKey | null =>
  tier === "plus" ? "time.tier.plus" : tier === "evergreen" ? "time.tier.evergreen" : null;
