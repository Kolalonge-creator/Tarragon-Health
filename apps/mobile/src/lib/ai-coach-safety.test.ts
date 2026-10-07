/**
 * The phone's hospital lookup is bounded: on a slow or absent connection it gives up (assistant.paging hospital_lookup_ms) and returns nothing,
 * so the bundled emergency guidance already on screen stands alone.
 */
jest.mock("./supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => undefined) }) }),
    }),
  },
}));
jest.mock("./api", () => ({ postCoachReport: jest.fn() }));

import { emergencyAddendum, loadEmergencyContext } from "./ai-coach-safety";

describe("the phone's emergency context read", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("gives up after the configured wait and returns an empty context", async () => {
    const pending = loadEmergencyContext("p1");
    await jest.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toEqual({ hospitals: [], contactName: null, contactPhone: null });
  });

  it("the addendum is empty (the bundled copy stands alone) when nothing could be read", async () => {
    const pending = emergencyAddendum("p1");
    await jest.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toBe("");
  });
});
