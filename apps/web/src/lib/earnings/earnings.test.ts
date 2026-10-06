import { describe, expect, it } from "@jest/globals";
import { adjustmentSchema, buildItemsFromForm, describeEarningsError, explainLine, feeItemsSchema, reviewWords, summarySchema } from "./earnings";

const TYPES = ["amber_bp_review", "symptom_review"];

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const base: Record<string, string> = {
    base_amber_bp_review: "1,000",
    step1_at_amber_bp_review: "50",
    step1_add_amber_bp_review: "10",
    step2_at_amber_bp_review: "100",
    step2_add_amber_bp_review: "25",
    base_symptom_review: "0",
    on_call_shift_fee: "20000",
    lead_fee: "1500",
    pilot_minimum: "2500",
    share_video: "60",
    share_audio: "50",
    share_phone: "40",
    reference_video: "10000",
    reference_audio: "",
    reference_phone: "",
    ...over,
  };
  for (const [k, v] of Object.entries(base)) f.set(k, v);
  return f;
}

describe("buildItemsFromForm", () => {
  it("turns naira into whole kobo and keeps the steps", () => {
    const r = buildItemsFromForm(form(), TYPES);
    expect(r).toEqual({
      ok: true,
      items: {
        task_types: {
          amber_bp_review: { base_fee_kobo: 100000, wait_multiplier_steps: [{ at_pct: 50, add_pct: 10 }, { at_pct: 100, add_pct: 25 }] },
          symptom_review: { base_fee_kobo: 0, wait_multiplier_steps: [] },
        },
        on_call_shift_fee_kobo: 2000000,
        lead_fee_per_patient_month_kobo: 150000,
        consultation_share_pct: { video: 60, audio: 50, phone: 40 },
        consultation_reference_price_kobo: { video: 1000000 },
        pilot_minimum_per_declared_hour_kobo: 250000,
      },
    });
  });
  it("omits reference prices when none are given", () => {
    const r = buildItemsFromForm(form({ reference_video: "" }), TYPES);
    expect(r.ok && "consultation_reference_price_kobo" in r.items).toBe(false);
  });
  it("refuses a blank fee instead of reading it as zero", () => {
    expect(buildItemsFromForm(form({ base_symptom_review: "" }), TYPES)).toEqual({ ok: false, error: "Please enter a fee for symptom_review (enter 0 for none)." });
  });
  it("refuses a blank shift, lead or minimum", () => {
    for (const k of ["on_call_shift_fee", "lead_fee", "pilot_minimum"]) {
      expect(buildItemsFromForm(form({ [k]: "" }), TYPES).ok).toBe(false);
    }
  });
  it("refuses a share that is blank, over 100 or not a whole number", () => {
    for (const v of ["", "101", "12.5", "abc"]) expect(buildItemsFromForm(form({ share_video: v }), TYPES).ok).toBe(false);
  });
  it("refuses half a step, a bad step and steps out of order", () => {
    expect(buildItemsFromForm(form({ step1_add_amber_bp_review: "" }), TYPES).ok).toBe(false);
    expect(buildItemsFromForm(form({ step1_at_amber_bp_review: "0" }), TYPES).ok).toBe(false);
    expect(buildItemsFromForm(form({ step1_add_amber_bp_review: "301" }), TYPES).ok).toBe(false);
    expect(buildItemsFromForm(form({ step1_at_amber_bp_review: "100", step2_at_amber_bp_review: "50" }), TYPES).ok).toBe(false);
    expect(buildItemsFromForm(form({ step1_at_amber_bp_review: "x" }), TYPES).ok).toBe(false);
  });
  it("a task type with no steps filled is valid", () => {
    const r = buildItemsFromForm(form({ step1_at_amber_bp_review: "", step1_add_amber_bp_review: "", step2_at_amber_bp_review: "", step2_add_amber_bp_review: "" }), TYPES);
    expect(r.ok && r.items.task_types.amber_bp_review?.wait_multiplier_steps).toEqual([]);
  });
  it("refuses an amount past the typo guard through the final schema", () => {
    expect(buildItemsFromForm(form({ lead_fee: "99999999999" }), TYPES).ok).toBe(false);
  });
});

describe("schemas and words", () => {
  it("feeItemsSchema rejects steps out of order and bad codes", () => {
    const bad = { task_types: { Bad: { base_fee_kobo: 1, wait_multiplier_steps: [] } }, on_call_shift_fee_kobo: 0, lead_fee_per_patient_month_kobo: 0, consultation_share_pct: { video: 0, audio: 0, phone: 0 }, pilot_minimum_per_declared_hour_kobo: 0 };
    expect(feeItemsSchema.safeParse(bad).success).toBe(false);
    const order = { ...bad, task_types: { ok: { base_fee_kobo: 1, wait_multiplier_steps: [{ at_pct: 90, add_pct: 1 }, { at_pct: 10, add_pct: 1 }] } } };
    expect(feeItemsSchema.safeParse(order).success).toBe(false);
  });
  it("an adjustment needs a clinician, a direction and a reason", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(adjustmentSchema.safeParse({ clinicianId: id, direction: "add", reason: "Agreed fee for this question" }).success).toBe(true);
    expect(adjustmentSchema.safeParse({ clinicianId: id, direction: "add", reason: "short" }).success).toBe(false);
    expect(adjustmentSchema.safeParse({ clinicianId: "x", direction: "add", reason: "Agreed fee for this question" }).success).toBe(false);
  });
  it("maps database errors to plain words and falls back otherwise", () => {
    expect(describeEarningsError({ message: "xx earnings_not_contracted" })).toMatch(/salary/);
    expect(describeEarningsError({ message: "boom" })).toBe("Something went wrong. Please try again.");
    expect(describeEarningsError(null, "custom")).toBe("custom");
  });
  it("summary parses what my_earnings_summary returns", () => {
    expect(summarySchema.safeParse({ lines: 1, total_kobo: 5, unpaid_kobo: 5, paid_kobo: 0, needs_review: 0, by_kind: { task: 5 } }).success).toBe(true);
  });
});

describe("explainLine", () => {
  it("explains each kind from the recorded inputs", () => {
    expect(explainLine({ kind: "task", calculation: { base_kobo: 100000, add_pct: 10 } })).toBe("Fee ₦1,000.00 plus 10 percent because the task had waited when you took it.");
    expect(explainLine({ kind: "task", calculation: { base_kobo: 100000, add_pct: 0 } })).toBe("Fee ₦1,000.00.");
    expect(explainLine({ kind: "consultation", calculation: { pct: 60, price_kobo: 1000000, basis: "reference_price" } })).toBe("60 percent of ₦10,000.00 (the schedule's reference price).");
    expect(explainLine({ kind: "consultation", calculation: { pct: 60, price_kobo: 1000000, basis: "purchase" } })).toBe("60 percent of ₦10,000.00.");
    expect(explainLine({ kind: "on_call_shift", calculation: { role: "primary", shift_fee_kobo: 2000000 } })).toBe("Shift fee ₦20,000.00.");
    expect(explainLine({ kind: "on_call_shift", calculation: { role: "backup", shift_fee_kobo: 2000000 } })).toBe("Backup share of the ₦20,000.00 shift fee.");
    expect(explainLine({ kind: "lead_month", calculation: { active_days: 31, lead_fee_kobo: 150000 } })).toBe("Led this patient on 31 days of the month. Fee ₦1,500.00.");
    expect(explainLine({ kind: "minimum_topup", calculation: { guarantee_kobo: 2000000, earned_in_run_kobo: 1500000 } })).toBe("Guarantee ₦20,000.00 for your declared hours, less ₦15,000.00 already earned in them.");
    expect(explainLine({ kind: "adjustment", calculation: { reason: "Agreed fee" } })).toBe("Agreed fee");
    expect(explainLine({ kind: "adjustment", calculation: {} })).toBe("A correction added by operations.");
    expect(explainLine({ kind: "other", calculation: {} })).toBe("");
    expect(explainLine({ kind: "task", calculation: { needs_review: "no_fee_for_task_type" } })).toMatch(/no fee/);
    expect(explainLine({ kind: "consultation", calculation: {} })).toBe("0 percent of .");
  });
  it("review words", () => {
    expect(reviewWords("no_price_basis")).toMatch(/price/);
    expect(reviewWords("something_new")).toBe("This line needs a person to check it.");
    expect(reviewWords(null)).toBe("");
  });
});
