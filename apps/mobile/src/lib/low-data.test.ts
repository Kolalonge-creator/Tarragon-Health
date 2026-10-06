const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
}));

import { LOW_DATA_KEY, loadLowDataPreference, readLowDataEnabled, writeLowDataEnabled } from "./low-data";
import { LOW_DATA_BUDGET, OFFLINE_BUDGET, activeBudget, setLowDataActive } from "./offline-budget";

beforeEach(() => {
  mockStore.clear();
  setLowDataActive(false);
});

describe("low-data budget", () => {
  it("only thins the pull side and keeps retention and test budgets", () => {
    expect(LOW_DATA_BUDGET.pullPageSize).toBeLessThan(OFFLINE_BUDGET.pullPageSize);
    expect(LOW_DATA_BUDGET.maxPagesPerPull).toBeLessThan(OFFLINE_BUDGET.maxPagesPerPull);
    expect(LOW_DATA_BUDGET.initialPullDays).toBeLessThan(OFFLINE_BUDGET.initialPullDays);
    expect(LOW_DATA_BUDGET.mirrorRetentionDays).toBe(OFFLINE_BUDGET.mirrorRetentionDays);
    expect(LOW_DATA_BUDGET.dailyBytesMax).toBe(OFFLINE_BUDGET.dailyBytesMax);
  });

  it("uses the normal budget until switched on", () => {
    expect(activeBudget()).toBe(OFFLINE_BUDGET);
    setLowDataActive(true);
    expect(activeBudget()).toBe(LOW_DATA_BUDGET);
  });
});

describe("preference", () => {
  it("defaults off and fails off on a corrupt value", async () => {
    expect(await readLowDataEnabled()).toBe(false);
    mockStore.set(LOW_DATA_KEY, "yes please");
    expect(await readLowDataEnabled()).toBe(false);
  });

  it("writing switches the active budget and survives a restart", async () => {
    await writeLowDataEnabled(true);
    expect(activeBudget()).toBe(LOW_DATA_BUDGET);
    setLowDataActive(false); // simulate a fresh process
    await loadLowDataPreference();
    expect(activeBudget()).toBe(LOW_DATA_BUDGET);
    await writeLowDataEnabled(false);
    expect(activeBudget()).toBe(OFFLINE_BUDGET);
  });
});
