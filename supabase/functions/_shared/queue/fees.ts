// S30: the calculations behind clinician fees (spec 7.7). Pure: no clock, no database, no hard-coded amounts.
// Every amount comes from an approved fee schedule (`fee_schedules.items`). The database writes the ledger
// (private.post_* in the S30 migration); this is the same arithmetic for tests and for a screen that wants to show
// the next task's fee. A shared table of cases (packages/queue/fixtures/fee-cases.json) runs through this file in Jest
// and through the SQL in the proof. All money is integer kobo (INV-15); every percentage rounds down to the kobo.

export type ConsultationType = "video" | "audio" | "phone";
export const CONSULTATION_TYPES: readonly ConsultationType[] = ["video", "audio", "phone"];
export const MAX_ITEM_KOBO = 1_000_000_000; // typo guard (10 million naira), not a policy

export interface WaitStep {
  /** Percent of the due window that has passed. 100 means the due time has been reached. */
  at_pct: number;
  /** Percent of the base fee added. Replaces, never stacks with, a lower step. */
  add_pct: number;
}
export interface TaskTypeFee {
  base_fee_kobo: number;
  wait_multiplier_steps: WaitStep[];
}
export interface FeeItems {
  task_types: Record<string, TaskTypeFee>;
  on_call_shift_fee_kobo: number;
  lead_fee_per_patient_month_kobo: number;
  consultation_share_pct: Record<ConsultationType, number>;
  consultation_reference_price_kobo?: Partial<Record<ConsultationType, number>>;
  pilot_minimum_per_declared_hour_kobo: number;
  /** S58b: fixed fee for one approved, published learning item. Optional: absent means no fee is set (a line is flagged). */
  creator_item_published_fee_kobo?: number;
}
export interface EarningsRules {
  lead_month: { min_active_days: number };
  on_call: { backup_fee_pct: number };
  minimum_guarantee: { counted_kinds: string[] };
}

const isKobo = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_ITEM_KOBO;
const isPct = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every reason a schedule's items are not acceptable. Empty means valid. The database CHECK is the same rule. */
export function validateFeeItems(items: unknown): string[] {
  if (!isObject(items)) return ["items must be an object"];
  const errors: string[] = [];
  const allowed = new Set(["task_types", "on_call_shift_fee_kobo", "lead_fee_per_patient_month_kobo", "consultation_share_pct", "consultation_reference_price_kobo", "pilot_minimum_per_declared_hour_kobo", "creator_item_published_fee_kobo"]);
  for (const k of Object.keys(items)) if (!allowed.has(k)) errors.push(`unknown key ${k}`);
  for (const k of ["on_call_shift_fee_kobo", "lead_fee_per_patient_month_kobo", "pilot_minimum_per_declared_hour_kobo"]) {
    if (!isKobo(items[k])) errors.push(`${k} must be a whole number of kobo, zero or more`);
  }
  if (items.creator_item_published_fee_kobo !== undefined && !isKobo(items.creator_item_published_fee_kobo)) {
    errors.push("creator_item_published_fee_kobo must be a whole number of kobo, zero or more");
  }
  const share = items.consultation_share_pct;
  if (!isObject(share) || Object.keys(share).length !== CONSULTATION_TYPES.length || !CONSULTATION_TYPES.every((t) => isPct(share[t], 100))) {
    errors.push("consultation_share_pct needs video, audio and phone, each 0 to 100");
  }
  const ref = items.consultation_reference_price_kobo;
  if (ref !== undefined && (!isObject(ref) || !Object.entries(ref).every(([k, v]) => (CONSULTATION_TYPES as readonly string[]).includes(k) && isKobo(v)))) {
    errors.push("consultation_reference_price_kobo must map video, audio or phone to kobo");
  }
  const types = items.task_types;
  if (!isObject(types)) {
    errors.push("task_types must be an object");
  } else {
    for (const [code, entry] of Object.entries(types)) {
      if (!/^[a-z][a-z0-9_]*$/.test(code)) errors.push(`task type code ${code} is not valid`);
      if (!isObject(entry) || !isKobo(entry.base_fee_kobo) || !Array.isArray(entry.wait_multiplier_steps)) {
        errors.push(`${code} needs base_fee_kobo and wait_multiplier_steps`);
        continue;
      }
      let last = 0;
      for (const step of entry.wait_multiplier_steps as unknown[]) {
        const s = isObject(step) ? step : {};
        if (!isPct(s.at_pct, 1000) || s.at_pct < 1 || !isPct(s.add_pct, 300) || s.at_pct <= last) {
          errors.push(`${code} steps must be increasing, at_pct 1 to 1000, add_pct 0 to 300`);
          break;
        }
        last = s.at_pct;
      }
    }
  }
  return errors;
}

/** The share of the due window that had passed at `claimedAt`, as a whole percent (floored). Reaching the due time is 100. */
export function elapsedPct(createdAt: Date, dueAt: Date, claimedAt: Date): number {
  const c = claimedAt.getTime();
  if (c >= dueAt.getTime()) return 100;
  const window = dueAt.getTime() - createdAt.getTime();
  if (window <= 0 || c <= createdAt.getTime()) return 0;
  return Math.floor((100 * (c - createdAt.getTime())) / window);
}

export interface TaskFeeFacts {
  taskType: string;
  createdAt: Date;
  dueAt: Date;
  claimedAt: Date;
}
export type TaskFee =
  | { ok: true; amountKobo: number; baseKobo: number; elapsedPct: number; stepAtPct: number | null; addPct: number; upliftKobo: number }
  | { ok: false; needsReview: "no_fee_for_task_type" };

/** The fee for one completed task. A task type missing from the schedule is flagged, never silently zero. */
export function taskFee(items: FeeItems, facts: TaskFeeFacts): TaskFee {
  const entry = items.task_types[facts.taskType];
  if (!entry) return { ok: false, needsReview: "no_fee_for_task_type" };
  const elapsed = elapsedPct(facts.createdAt, facts.dueAt, facts.claimedAt);
  let stepAtPct: number | null = null;
  let addPct = 0;
  for (const s of entry.wait_multiplier_steps) {
    if (s.at_pct <= elapsed && (stepAtPct === null || s.at_pct > stepAtPct)) {
      stepAtPct = s.at_pct;
      addPct = s.add_pct;
    }
  }
  const upliftKobo = Math.floor((entry.base_fee_kobo * addPct) / 100);
  return { ok: true, amountKobo: entry.base_fee_kobo + upliftKobo, baseKobo: entry.base_fee_kobo, elapsedPct: elapsed, stepAtPct, addPct, upliftKobo };
}

export type ConsultationShare =
  | { ok: true; amountKobo: number; priceKobo: number; pct: number; basis: "purchase" | "reference_price" }
  | { ok: false; needsReview: "no_price_basis" };

/** A consultation the clinician delivered: a share of the paid price, else of the schedule's reference price, else flagged. */
export function consultationShare(items: FeeItems, type: ConsultationType, purchaseKobo: number | null): ConsultationShare {
  const pct = items.consultation_share_pct[type];
  const reference = items.consultation_reference_price_kobo?.[type];
  const price = purchaseKobo ?? reference ?? null;
  if (price === null) return { ok: false, needsReview: "no_price_basis" };
  return { ok: true, amountKobo: Math.floor((price * pct) / 100), priceKobo: price, pct, basis: purchaseKobo === null ? "reference_price" : "purchase" };
}

/** One lead-month line: the fee for a patient led on at least `minActiveDays` days of the month, else nothing. */
export function leadMonthFee(items: FeeItems, rules: EarningsRules, activeDays: number): number {
  return activeDays >= rules.lead_month.min_active_days ? items.lead_fee_per_patient_month_kobo : 0;
}

/** The shift fee for the primary clinician, or the backup's configured percent of it. */
export function onCallShiftFee(items: FeeItems, rules: EarningsRules, role: "primary" | "backup"): number {
  return role === "primary" ? items.on_call_shift_fee_kobo : Math.floor((items.on_call_shift_fee_kobo * rules.on_call.backup_fee_pct) / 100);
}

/** The pilot minimum for a run of declared hours: only the shortfall is paid. `declaredSeconds` is the merged run. */
export function minimumTopUp(items: FeeItems, declaredSeconds: number, earnedKobo: number): { guaranteeKobo: number; topUpKobo: number } {
  const guaranteeKobo = Math.floor((items.pilot_minimum_per_declared_hour_kobo * declaredSeconds) / 3600);
  return { guaranteeKobo, topUpKobo: Math.max(0, guaranteeKobo - earnedKobo) };
}

/** Merge overlapping or touching [start, end) runs, as the database does with a range aggregate. */
export function mergeRuns(runs: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = runs.map((r): [number, number] => [r[0], r[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}
