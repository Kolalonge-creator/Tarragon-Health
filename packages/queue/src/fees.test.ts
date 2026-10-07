import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consultationShare,
  elapsedPct,
  leadMonthFee,
  mergeRuns,
  minimumTopUp,
  onCallShiftFee,
  taskFee,
  validateFeeItems,
  type ConsultationType,
  type EarningsRules,
  type FeeItems,
} from "../../../supabase/functions/_shared/queue/fees";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const fx = JSON.parse(readFileSync(join(HERE, "..", "fixtures", "fee-cases.json"), "utf8")) as {
  items: FeeItems;
  rules: EarningsRules;
  taskCases: Array<{ name: string; type: string; created: string; due: string; claimed: string; expect: { amount?: number; elapsed?: number; step?: number | null; addPct?: number; needsReview?: string } }>;
  consultationCases: Array<{ name: string; type: ConsultationType; purchase: number | null; expect: { amount?: number; basis?: string; needsReview?: string } }>;
  leadCases: Array<{ name: string; days: number; expect: number }>;
  onCallCases: Array<{ name: string; role: "primary" | "backup"; expect: number }>;
  minimumCases: Array<{ name: string; seconds: number; earned: number; expect: { guarantee: number; topUp: number } }>;
  invalidItems: Array<{ name: string; mutate: Record<string, unknown> }>;
};

describe("fee items validation", () => {
  it("accepts the shared schedule", () => expect(validateFeeItems(fx.items)).toEqual([]));
  it("accepts a schedule without reference prices", () => {
    const { consultation_reference_price_kobo: _unused, ...rest } = fx.items;
    expect(validateFeeItems(rest)).toEqual([]);
  });
  for (const c of fx.invalidItems) {
    it(`refuses ${c.name}`, () => expect(validateFeeItems({ ...fx.items, ...c.mutate }).length).toBeGreaterThan(0));
  }
  it("accepts a whole-kobo creator item fee and refuses a fractional, negative or non-number one", () => {
    expect(validateFeeItems({ ...fx.items, creator_item_published_fee_kobo: 250000 })).toEqual([]);
    for (const bad of [1.5, -1, "250000", null]) {
      expect(validateFeeItems({ ...fx.items, creator_item_published_fee_kobo: bad }).length).toBeGreaterThan(0);
    }
  });
  it("refuses a non-object and an array", () => {
    expect(validateFeeItems(null)).toEqual(["items must be an object"]);
    expect(validateFeeItems([])).toEqual(["items must be an object"]);
  });
  it("refuses a task type entry that is not an object", () => {
    expect(validateFeeItems({ ...fx.items, task_types: { symptom_review: 5 } }).length).toBeGreaterThan(0);
  });
  it("refuses a step that is not an object", () => {
    expect(validateFeeItems({ ...fx.items, task_types: { symptom_review: { base_fee_kobo: 1, wait_multiplier_steps: [7] } } }).length).toBeGreaterThan(0);
  });
});

describe("taskFee (shared cases, also run through the database)", () => {
  for (const c of fx.taskCases) {
    it(c.name, () => {
      const r = taskFee(fx.items, { taskType: c.type, createdAt: new Date(c.created), dueAt: new Date(c.due), claimedAt: new Date(c.claimed) });
      if (c.expect.needsReview) {
        expect(r).toEqual({ ok: false, needsReview: c.expect.needsReview });
      } else {
        expect(r).toMatchObject({ ok: true, amountKobo: c.expect.amount, elapsedPct: c.expect.elapsed, stepAtPct: c.expect.step, addPct: c.expect.addPct });
      }
    });
  }
  it("elapsedPct is floored and capped", () => {
    const created = new Date("2026-10-01T00:00:00Z");
    const due = new Date("2026-10-01T03:00:00Z");
    expect(elapsedPct(created, due, new Date("2026-10-01T01:00:00Z"))).toBe(33);
    expect(elapsedPct(created, due, new Date("2026-10-05T00:00:00Z"))).toBe(100);
  });
});

describe("consultationShare (shared cases)", () => {
  for (const c of fx.consultationCases) {
    it(c.name, () => {
      const r = consultationShare(fx.items, c.type, c.purchase);
      if (c.expect.needsReview) expect(r).toEqual({ ok: false, needsReview: c.expect.needsReview });
      else expect(r).toMatchObject({ ok: true, amountKobo: c.expect.amount, basis: c.expect.basis });
    });
  }
});

describe("lead month, on call, minimum (shared cases)", () => {
  for (const c of fx.leadCases) it(c.name, () => expect(leadMonthFee(fx.items, fx.rules, c.days)).toBe(c.expect));
  for (const c of fx.onCallCases) it(c.name, () => expect(onCallShiftFee(fx.items, fx.rules, c.role)).toBe(c.expect));
  for (const c of fx.minimumCases) it(c.name, () => expect(minimumTopUp(fx.items, c.seconds, c.earned)).toEqual({ guaranteeKobo: c.expect.guarantee, topUpKobo: c.expect.topUp }));
});

describe("mergeRuns", () => {
  it("merges overlapping and touching runs and keeps separate ones apart", () => {
    expect(mergeRuns([[10, 20], [0, 5], [5, 8], [15, 30], [40, 50]])).toEqual([[0, 8], [10, 30], [40, 50]]);
  });
  it("a run inside another does not shrink it", () => expect(mergeRuns([[0, 100], [10, 20]])).toEqual([[0, 100]]));
  it("runs that start together are ordered by their end", () => expect(mergeRuns([[0, 9], [0, 3], [20, 30]])).toEqual([[0, 9], [20, 30]]));
  it("handles none", () => expect(mergeRuns([])).toEqual([]));
});
