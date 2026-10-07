import {
  loadAverageGate,
  loadHomeProtocol,
  loadReminderBehaviour,
  loadStartingSuggestionTarget,
  loadStreakRules,
  loadTrendDisplay,
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
