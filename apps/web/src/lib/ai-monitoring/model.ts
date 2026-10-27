import { z } from "zod";

/**
 * S80d (25.10): the AI monitoring screen. The database builds the overview (ids, counts, categories and dates, never an answer's text or a patient's
 * name) and the escalation-accuracy report (S38e, small groups withheld); this parses both and refuses anything unexpected, so a half-read answer
 * is shown as a load error and never as an all-clear.
 */
export const RULE_WORDS: Record<string, string> = {
  stratified: "Random share",
  flagged: "Flagged by the system",
  risk_emergency: "Touched an emergency or doctor-escalation grade",
  risk_reported: "A patient said the answer was wrong",
  risk_cost_spike: "Unusually large call",
};

export const overviewSchema = z.object({
  scheduler: z.object({
    armed: z.boolean(),
    signed_version: z.string().nullable(),
    waiting_for_signature_version: z.number().nullable(),
    sample_rate: z.string().nullable(),
    last_run: z.object({ month: z.string(), drawn: z.number(), ran_at: z.string() }).nullable(),
  }),
  samples: z.array(z.object({ month: z.string(), rule: z.string(), drawn: z.coerce.number(), reviewed: z.coerce.number() })),
  reported: z.array(
    z.object({
      incident_id: z.string().uuid(),
      system_code: z.string(),
      category: z.string(),
      severity: z.string(),
      status: z.string(),
      created_at: z.string(),
      in_review_sample: z.boolean(),
    }),
  ),
  reported_last_30_days: z.coerce.number(),
});
export type Overview = z.infer<typeof overviewSchema>;

const cell = z.union([z.object({ suppressed: z.literal(true), minimum: z.number().optional() }), z.object({ suppressed: z.literal(false), reviewed: z.number(), agree_pct: z.number(), should_have_been_higher_pct: z.number(), should_have_been_lower_pct: z.number() })]);

export const accuracySchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  capture_switched_on: z.boolean().nullable(),
  coverage: z.union([z.object({ suppressed: z.literal(true) }), z.object({ suppressed: z.literal(false), reviewed_pct: z.number(), low_coverage: z.boolean() })]),
  overall: cell,
  what_this_is: z.string(),
});
export type Accuracy = z.infer<typeof accuracySchema>;

/** The scheduler line, in plain words. */
export function schedulerStatus(s: Overview["scheduler"]): { state: "armed" | "waiting" | "off"; text: string } {
  if (s.armed) return { state: "armed", text: `On. The monthly draw runs on the 1st using signed rules version ${s.signed_version ?? "?"}.` };
  if (s.waiting_for_signature_version !== null) {
    return { state: "waiting", text: `Off. Rules version ${s.waiting_for_signature_version} are waiting for the Chief Medical Officer's signature on the sign-off page. Until then no monthly sample is drawn.` };
  }
  return { state: "off", text: "Off. There are no signed sampling rules, so no monthly sample is drawn." };
}

/** Group sample rows by month for the table. Pure, keeps database order within a month. */
export function samplesByMonth(rows: Overview["samples"]): { month: string; lines: { rule: string; drawn: number; reviewed: number }[] }[] {
  const out: { month: string; lines: { rule: string; drawn: number; reviewed: number }[] }[] = [];
  for (const r of rows) {
    let g = out.find((x) => x.month === r.month);
    if (!g) {
      g = { month: r.month, lines: [] };
      out.push(g);
    }
    g.lines.push({ rule: RULE_WORDS[r.rule] ?? r.rule, drawn: r.drawn, reviewed: r.reviewed });
  }
  return out;
}
