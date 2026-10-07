import { z } from "zod";

/** S80c: AI answer review and AI cost (spec 25.10, D.5). The database samples, audits the queue read and computes kobo cost. */
export const VERDICTS = ["accurate", "minor_issue", "harmful", "not_reviewable"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const queueRowSchema = z.object({
  sample_id: z.string().uuid(),
  system_code: z.string(),
  sample_month: z.string(),
  sampled_by_rule: z.enum(["stratified", "flagged"]),
  output_summary: z.string().nullable(),
  created_at: z.string(),
});
export type QueueRow = z.infer<typeof queueRowSchema>;
export const queueRowsSchema = z.array(queueRowSchema);

export const costRowSchema = z.object({
  system_code: z.string(),
  month: z.string(),
  calls: z.coerce.number(),
  input_tokens: z.coerce.number(),
  output_tokens: z.coerce.number(),
  cost_kobo: z.coerce.number().nullable(),
  unpriced_calls: z.coerce.number(),
});
export type CostRow = z.infer<typeof costRowSchema>;
export const costRowsSchema = z.array(costRowSchema);

export const NOTICES = ["saved", "harmful", "failed"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: string | undefined): Notice | null => (NOTICES as readonly string[]).includes(v ?? "") ? (v as Notice) : null;

export const verdictFormSchema = z.object({
  id: z.string().uuid(),
  verdict: z.enum(VERDICTS),
  note: z.string().trim().max(1000),
}).refine((v) => !["minor_issue", "harmful"].includes(v.verdict) || v.note.length >= 10, { path: ["note"] });

/** Integer kobo to a naira string for display only. Money is never held as a float. */
export function nairaFromKobo(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const abs = Math.abs(kobo);
  const whole = Math.trunc(abs / 100);
  const minor = String(abs % 100).padStart(2, "0");
  return `${sign}\u20A6${whole.toLocaleString("en-NG")}.${minor}`;
}
