/**
 * logVital's outer try/catch (added for the offline-resilience fix, see
 * docs/OFFLINE_RESILIENCE_AUDIT.md) originally wrapped the ENTIRE function
 * body, including the assess*BestEffort/recordWeeklyPlanProgress calls that
 * run AFTER the vitals_readings insert already succeeded. Those helpers are
 * documented "never throws," but that contract isn't literally enforced by
 * a try/catch inside every one of them — assessBpControlBestEffort,
 * assessHeartRateBestEffort, and assessGlucoseBestEffort each await a
 * Supabase call directly with no internal try/catch. A network drop right
 * after a successful insert was therefore caught by the OUTER catch and
 * reported as "Couldn't save that reading" — false (the reading WAS saved)
 * and risked a duplicate insert if the patient believed it and retried.
 * This proves a failure in that post-insert tail is now caught separately,
 * reported to Sentry, and still returns `{ success: true }` — the correct
 * signal, since the insert genuinely succeeded.
 */

jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: jest.fn().mockResolvedValue("patient-1"),
  assertNotActingFor: jest.fn(),
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const assessHeartRateBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-heart-rate", () => ({
  assessHeartRateBestEffort: (...args: unknown[]) => assessHeartRateBestEffort(...args),
}));
jest.mock("@/lib/ml/assess-bp-control", () => ({
  assessBpControlBestEffort: jest.fn(),
}));
jest.mock("@/lib/vitals/assess-glucose", () => ({
  assessGlucoseBestEffort: jest.fn(),
}));
jest.mock("@/lib/health-score/assess-health-score", () => ({
  assessHealthScoreBestEffort: jest.fn(),
}));
jest.mock("@/lib/lifestyle/weekly-plan-progress", () => ({
  recordWeeklyPlanProgress: jest.fn(),
}));

const insert = jest.fn();
const single = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "patient-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single }) }) };
      }
      if (table === "vitals_readings") {
        return { insert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { logVital } from "./actions";

function pulseFormData() {
  const fd = new FormData();
  fd.set("vital_type", "pulse");
  fd.set("pulse_bpm", "72");
  return fd;
}

describe("logVital — post-insert best-effort failure", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessHeartRateBestEffort.mockReset();
    single.mockResolvedValue({ data: { organisation_id: "org-1" } });
    insert.mockResolvedValue({ error: null });
  });

  it("still reports success when the insert succeeded but a downstream best-effort call throws", async () => {
    // The load-bearing assertion is `toEqual({ success: true })` — this IS
    // the sabotage check: without the inner try/catch added in this fix,
    // the rejection below would propagate up to logVital's own OUTER catch
    // instead, and `result` would be `{ error: "Couldn't save that
    // reading..." }`, failing this exact assertion.
    assessHeartRateBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const result = await logVital(undefined, pulseFormData());

    expect(result).toEqual({ success: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({ extra: expect.objectContaining({ stage: "post_insert_best_effort" }) })
    );
  });
});
