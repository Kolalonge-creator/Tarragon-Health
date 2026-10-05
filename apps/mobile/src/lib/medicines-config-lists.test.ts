import { getProposedConfig } from "@tarragon/shared";
import { loadMedicineRules } from "./medicines-config";

/**
 * The list-valued setting (catchUpRetrySeconds) is the one place the loader accepts an array, so a
 * bad entry must fail loudly rather than reach a timer as NaN, zero or a negative delay.
 */
jest.mock("@tarragon/shared", () => ({ getProposedConfig: jest.fn() }));

const good = {
  undoSeconds: 120,
  doubleTapGuardMs: 800,
  lowSupplyDays: 7,
  adherenceMinDoses: 3,
  stalePlanHours: 24,
  serverMissedAfterMinutes: 720,
  followUpMinWindowMinutes: 30,
  catchUpMaxItems: 12,
  catchUpMinGapMinutes: 240,
  catchUpRetrySeconds: [30, 120],
  backdateWindowHours: 72,
  futureSkewMinutes: 5,
  maxFollowUps: 8,
};

function withValue(value: unknown) {
  (getProposedConfig as jest.Mock).mockReturnValue({ value, version: 1 });
}

describe("catchUpRetrySeconds", () => {
  it("accepts a short list of positive numbers, and an empty one (no retries)", () => {
    withValue(good);
    expect(loadMedicineRules().catchUpRetrySeconds).toEqual([30, 120]);
    withValue({ ...good, catchUpRetrySeconds: [] });
    expect(loadMedicineRules().catchUpRetrySeconds).toEqual([]);
  });

  it.each([
    ["not a list", 30],
    ["too many", [1, 2, 3, 4, 5, 6]],
    ["a string", ["30"]],
    ["zero", [0]],
    ["negative", [-5]],
    ["not finite", [Infinity]],
    ["NaN", [NaN]],
  ])("refuses %s", (_name, value) => {
    withValue({ ...good, catchUpRetrySeconds: value });
    expect(() => loadMedicineRules()).toThrow(/catchUpRetrySeconds/);
  });
});
