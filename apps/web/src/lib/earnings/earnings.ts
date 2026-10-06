import { z } from "zod";
import { formatKobo, nairaInputToKobo } from "@/lib/format-money";

/**
 * Fee schedules and the earnings ledger (S30, spec 7.7). Input schemas, the plain-words error mapping, the parsers for the
 * admin and clinician reads, and the one place a form's naira fields become the schedule's kobo items. No server-only imports so
 * actions, pages and tests share one definition. Money is integer kobo (INV-15): nothing here does floating-point arithmetic on it.
 */

export const REASON_MIN = 10;
export const REASON_MAX = 1000;
export const CONSULTATION_TYPES = ["video", "audio", "phone"] as const;
export type ConsultationType = (typeof CONSULTATION_TYPES)[number];

export const KIND_LABEL: Record<string, string> = {
  task: "Task completed",
  consultation: "Consultation",
  on_call_shift: "On-call shift",
  lead_month: "Lead clinician month",
  minimum_topup: "Pilot minimum top-up",
  adjustment: "Adjustment",
};

const ERROR_WORDS: Record<string, string> = {
  fee_not_authorised: "You do not have access to fee schedules.",
  fee_items_invalid: "The fee schedule has an amount or percentage that is not allowed. Amounts are whole kobo, percentages are whole numbers.",
  fee_items_needed: "There is no approved schedule to copy yet. Fill in the form to start the first one.",
  fee_unknown_schedule: "That schedule could not be found.",
  fee_not_a_draft: "Only a draft can be changed or approved. An approved schedule never changes; make a new version.",
  fee_unknown_task_type: "A task type in the schedule does not exist.",
  earnings_bad_amount: "Please enter an amount that is not zero.",
  earnings_reason_needed: `Please give a reason of at least ${REASON_MIN} characters.`,
  earnings_not_contracted: "This person is paid by salary, so there are no per-task earnings to adjust.",
  earnings_unknown_line: "That earnings line could not be found for this clinician.",
};

export function describeEarningsError(
  error: { message?: string | null; code?: string | null } | null | undefined,
  fallback = "Something went wrong. Please try again.",
): string {
  const message = error?.message ?? "";
  for (const key of Object.keys(ERROR_WORDS)) {
    if (message.includes(key)) return ERROR_WORDS[key] as string;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// The schedule: kobo items, built from a form that takes naira and whole-number percentages
// ---------------------------------------------------------------------------
export type WaitStep = {
  at_pct: number;
  add_pct: number;
};
export type TaskTypeFee = {
  base_fee_kobo: number;
  wait_multiplier_steps: WaitStep[];
};
export type FeeItems = {
  task_types: Record<string, TaskTypeFee>;
  on_call_shift_fee_kobo: number;
  lead_fee_per_patient_month_kobo: number;
  consultation_share_pct: Record<ConsultationType, number>;
  consultation_reference_price_kobo?: Partial<Record<ConsultationType, number>>;
  pilot_minimum_per_declared_hour_kobo: number;
};

const wholePct = (max: number) => z.coerce.number().int().min(0).max(max);
const wholeKobo = z.number().int().min(0).max(1_000_000_000);

export const feeItemsSchema: z.ZodType<FeeItems> = z.object({
  task_types: z.record(
    z.string().regex(/^[a-z][a-z0-9_]*$/),
    z.object({
      base_fee_kobo: wholeKobo,
      wait_multiplier_steps: z
        .array(z.object({ at_pct: z.number().int().min(1).max(1000), add_pct: z.number().int().min(0).max(300) }))
        .refine((steps) => steps.every((s, i) => i === 0 || s.at_pct > (steps[i - 1] as WaitStep).at_pct), "Steps must be in increasing order"),
    }),
  ),
  on_call_shift_fee_kobo: wholeKobo,
  lead_fee_per_patient_month_kobo: wholeKobo,
  consultation_share_pct: z.object({ video: z.number().int().min(0).max(100), audio: z.number().int().min(0).max(100), phone: z.number().int().min(0).max(100) }),
  consultation_reference_price_kobo: z.object({ video: wholeKobo.optional(), audio: wholeKobo.optional(), phone: wholeKobo.optional() }).optional(),
  pilot_minimum_per_declared_hour_kobo: wholeKobo,
});

export type FormBuildResult = { ok: true; items: FeeItems } | { ok: false; error: string };

const pctOrNull = (v: FormDataEntryValue | null): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const parsed = wholePct(1000).safeParse(v.trim());
  return parsed.success ? parsed.data : Number.NaN;
};

/**
 * Turns the admin form into schedule items. Every money field must be filled (a blank is refused, never read as zero, so a
 * founder cannot approve an amount by leaving a box empty); a step with no percent is simply not a step.
 */
export function buildItemsFromForm(form: FormData, taskTypes: readonly string[]): FormBuildResult {
  const money = (name: string): number | null => nairaInputToKobo(form.get(name));
  const task_types: Record<string, TaskTypeFee> = {};
  for (const code of taskTypes) {
    const base = money(`base_${code}`);
    if (base === null) return { ok: false, error: `Please enter a fee for ${code} (enter 0 for none).` };
    const steps: WaitStep[] = [];
    for (const slot of [1, 2]) {
      const at = pctOrNull(form.get(`step${slot}_at_${code}`));
      const add = pctOrNull(form.get(`step${slot}_add_${code}`));
      if (at === null && add === null) continue;
      if (at === null || add === null || Number.isNaN(at) || Number.isNaN(add) || at < 1 || add > 300) {
        return { ok: false, error: `Please check the step for ${code}: a whole number from 1 for when, and a whole number up to 300 for how much extra.` };
      }
      steps.push({ at_pct: at, add_pct: add });
    }
    if (steps.some((s, i) => i > 0 && s.at_pct <= (steps[i - 1] as WaitStep).at_pct)) {
      return { ok: false, error: `The two steps for ${code} must be in increasing order.` };
    }
    task_types[code] = { base_fee_kobo: base, wait_multiplier_steps: steps };
  }
  const onCall = money("on_call_shift_fee");
  const lead = money("lead_fee");
  const minimum = money("pilot_minimum");
  if (onCall === null || lead === null || minimum === null) {
    return { ok: false, error: "Please fill in the on-call shift fee, the lead fee and the pilot minimum (enter 0 for none)." };
  }
  const share = {} as Record<ConsultationType, number>;
  const reference: Partial<Record<ConsultationType, number>> = {};
  for (const type of CONSULTATION_TYPES) {
    const pct = pctOrNull(form.get(`share_${type}`));
    if (pct === null || Number.isNaN(pct) || pct > 100) return { ok: false, error: `Please enter the ${type} share as a whole number from 0 to 100.` };
    share[type] = pct;
    const ref = money(`reference_${type}`);
    if (ref !== null) reference[type] = ref;
  }
  const items: FeeItems = {
    task_types,
    on_call_shift_fee_kobo: onCall,
    lead_fee_per_patient_month_kobo: lead,
    consultation_share_pct: share,
    pilot_minimum_per_declared_hour_kobo: minimum,
    ...(Object.keys(reference).length > 0 ? { consultation_reference_price_kobo: reference } : {}),
  };
  const checked = feeItemsSchema.safeParse(items);
  return checked.success ? { ok: true, items } : { ok: false, error: checked.error.issues[0]?.message ?? "The schedule is not valid." };
}

// ---------------------------------------------------------------------------
// Admin and clinician actions
// ---------------------------------------------------------------------------
const reasonSchema = z
  .string()
  .trim()
  .min(REASON_MIN, `Please give a reason of at least ${REASON_MIN} characters.`)
  .max(REASON_MAX, `Please keep the reason under ${REASON_MAX.toLocaleString("en-GB")} characters.`);

export const adjustmentSchema = z.object({
  clinicianId: z.string().uuid(),
  direction: z.enum(["add", "take_away"]),
  corrects: z.string().uuid().optional(),
  reason: reasonSchema,
});

export const scheduleIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export const ledgerRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  amount_kobo: z.number(),
  earned_at: z.string(),
  payout_id: z.string().nullable(),
  is_test: z.boolean(),
  calculation: z.record(z.string(), z.unknown()),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;
export const ledgerRowsSchema = z.array(ledgerRowSchema);

export const summarySchema = z.object({
  lines: z.number(),
  total_kobo: z.number(),
  unpaid_kobo: z.number(),
  paid_kobo: z.number(),
  needs_review: z.number(),
  by_kind: z.record(z.string(), z.number()),
});
export type Summary = z.infer<typeof summarySchema>;

export const myScheduleSchema = z.union([
  z.object({ approved: z.literal(false) }),
  z.object({ approved: z.literal(true), version: z.number(), approved_at: z.string(), items: feeItemsSchema }),
]);

export const adminSummaryRowsSchema = z.array(
  z.object({ clinician_id: z.string().uuid(), full_name: z.string().nullable(), lines: z.number(), total_kobo: z.number(), unpaid_kobo: z.number(), needs_review: z.number() }),
);
export const reviewRowsSchema = z.array(
  z.object({ id: z.string().uuid(), clinician_id: z.string().uuid(), kind: z.string(), earned_at: z.string(), needs_review: z.string().nullable(), task_type: z.string().nullable() }),
);
export const healthSchema = z.object({
  approved_version: z.number().nullable(),
  tasks_waiting_for_a_schedule: z.number(),
  oldest_waiting_at: z.string().nullable(),
  lines_needing_review: z.number(),
});
export const scheduleRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    version: z.number(),
    status: z.enum(["draft", "approved", "superseded"]),
    items: feeItemsSchema,
    note: z.string().nullable(),
    created_at: z.string(),
    approved_at: z.string().nullable(),
  }),
);

const REVIEW_WORDS: Record<string, string> = {
  no_fee_for_task_type: "This task type has no fee in the schedule. Post an adjustment with the agreed amount.",
  no_price_basis: "There was no price to take the share of. Post an adjustment with the agreed amount.",
};
export const reviewWords = (code: string | null): string => (code ? (REVIEW_WORDS[code] ?? "This line needs a person to check it.") : "");

/** A one-line, plain explanation of how a ledger line was worked out, from the inputs the database recorded. */
export function explainLine(row: Pick<LedgerRow, "kind" | "calculation">): string {
  const c = row.calculation;
  const num = (k: string): number | null => (typeof c[k] === "number" ? (c[k] as number) : null);
  const kobo = (n: number | null): string => (n === null ? "" : formatKobo(n));
  if (typeof c.needs_review === "string") return reviewWords(c.needs_review);
  switch (row.kind) {
    case "task": {
      const add = num("add_pct") ?? 0;
      return add > 0 ? `Fee ${kobo(num("base_kobo"))} plus ${add} percent because the task had waited when you took it.` : `Fee ${kobo(num("base_kobo"))}.`;
    }
    case "consultation":
      return `${num("pct") ?? 0} percent of ${kobo(num("price_kobo"))}${c.basis === "reference_price" ? " (the schedule's reference price)" : ""}.`;
    case "on_call_shift":
      return c.role === "backup" ? `Backup share of the ${kobo(num("shift_fee_kobo"))} shift fee.` : `Shift fee ${kobo(num("shift_fee_kobo"))}.`;
    case "lead_month":
      return `Led this patient on ${num("active_days") ?? 0} days of the month. Fee ${kobo(num("lead_fee_kobo"))}.`;
    case "minimum_topup":
      return `Guarantee ${kobo(num("guarantee_kobo"))} for your declared hours, less ${kobo(num("earned_in_run_kobo"))} already earned in them.`;
    case "adjustment":
      return typeof c.reason === "string" ? c.reason : "A correction added by operations.";
    default:
      return "";
  }
}
