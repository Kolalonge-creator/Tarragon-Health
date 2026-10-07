import {
  loadAverageGate,
  loadHomeProtocol,
  loadReminderBehaviour,
  loadStartingSuggestionTarget,
  loadStreakRules,
  loadTrendDisplay,
  suggestionForAge,
  type StartingSuggestionTarget,
} from "./s07-config";

// These check that the registry entries parse into the shapes the S07 modules expect.
// They deliberately assert shape, not the proposed numbers, which the CMO may change.
describe("S07 config loaders", () => {
  it("parse every S07 registry entry", () => {
    expect(loadHomeProtocol().version).toBeGreaterThanOrEqual(1);
    expect(loadAverageGate().rules.length).toBeGreaterThan(0);
    expect(loadTrendDisplay().minReadingsForChart).toBeGreaterThan(0);
    expect(loadStartingSuggestionTarget().systolicBelow).toBeGreaterThan(0);
    expect(loadReminderBehaviour().maxPending).toBeGreaterThan(0);
    expect(loadStreakRules().freezeEarnEveryDays).toBeGreaterThan(0);
  });

  it("keeps the medicine and blood pressure reminder budgets under the phone's 64 pending notifications together", () => {
    const c = loadReminderBehaviour();
    expect(c.maxPendingBp).toBeGreaterThan(0);
    expect(c.maxPending + c.maxPendingBp).toBeLessThan(64);
  });

  it("keep the home-protocol hour ranges well formed and non-overlapping", () => {
    const p = loadHomeProtocol();
    expect(p.morningHours[0]).toBeLessThan(p.morningHours[1]);
    expect(p.eveningHours[0]).toBeLessThan(p.eveningHours[1]);
    expect(p.morningHours[1]).toBeLessThanOrEqual(p.eveningHours[0]);
  });
});

describe("starting blood pressure suggestion (NICE NG136 home averages)", () => {
  const base: StartingSuggestionTarget = { version: 2, systolicBelow: 135, diastolicBelow: 85, ageBands: [{ fromAgeYears: 80, systolicBelow: 145, diastolicBelow: 85 }] };

  it("is the confirmed NICE pair: under 135/85 for adults under 80, under 145/85 from 80", () => {
    const loaded = loadStartingSuggestionTarget();
    expect(loaded.version).toBeGreaterThanOrEqual(2);
    expect([loaded.systolicBelow, loaded.diastolicBelow]).toEqual([135, 85]);
    expect(loaded.ageBands).toEqual([{ fromAgeYears: 80, systolicBelow: 145, diastolicBelow: 85 }]);
  });

  it("uses the base pair below 80, the older-adult pair from 80, and the base when the age is unknown", () => {
    expect(suggestionForAge(base, 45)).toBe(base);
    expect(suggestionForAge(base, 79)).toBe(base);
    expect(suggestionForAge(base, 80)).toMatchObject({ systolicBelow: 145, diastolicBelow: 85 });
    expect(suggestionForAge(base, 93)).toMatchObject({ systolicBelow: 145, diastolicBelow: 85 });
    expect(suggestionForAge(base, null)).toBe(base);
  });

  it("never loosens the target when there are no bands", () => {
    const flat: StartingSuggestionTarget = { version: 1, systolicBelow: 135, diastolicBelow: 85 };
    expect(suggestionForAge(flat, 90)).toBe(flat);
  });

  it("picks the highest band that has been reached when there are several", () => {
    const many: StartingSuggestionTarget = {
      ...base,
      ageBands: [
        { fromAgeYears: 80, systolicBelow: 145, diastolicBelow: 85 },
        { fromAgeYears: 90, systolicBelow: 150, diastolicBelow: 90 },
      ],
    };
    expect(suggestionForAge(many, 85)).toMatchObject({ systolicBelow: 145 });
    expect(suggestionForAge(many, 91)).toMatchObject({ systolicBelow: 150, diastolicBelow: 90 });
  });
});
