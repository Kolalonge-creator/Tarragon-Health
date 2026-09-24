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
 *
 * A first fix caught the whole post-insert tail in one try/catch and always
 * returned a clean `{ success: true }`. Review caught a second, more
 * serious problem with that: assessBpControlBestEffort/
 * assessHeartRateBestEffort/assessGlucoseBestEffort are the platform's
 * actual red-flag/escalation detection for this reading — silently
 * absorbing a failure there as a clean "Reading logged" would hide a real
 * abnormal-result check that never ran, which CLAUDE.md explicitly forbids
 * ("Never deprioritise or silently swallow an abnormal screening result
 * event"). recordWeeklyPlanProgress/assessHealthScoreBestEffort, by
 * contrast, are genuinely inert bookkeeping with no clinical-safety
 * consequence.
 *
 * This proves both halves: a safety-assessment failure still reports
 * `success: true` (the row IS saved, and duplicate-insert risk still
 * matters) but ALSO carries a distinct, honest `error` telling the patient
 * the safety check didn't finish — never a silent, unqualified success. An
 * inert-bookkeeping failure stays silent (Sentry-only), which is correct,
 * not an oversight.
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
const assessHealthScoreBestEffort = jest.fn();
jest.mock("@/lib/health-score/assess-health-score", () => ({
  assessHealthScoreBestEffort: (...args: unknown[]) => assessHealthScoreBestEffort(...args),
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

describe("logVital — post-insert failure handling", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessHeartRateBestEffort.mockReset();
    assessHealthScoreBestEffort.mockReset();
    single.mockResolvedValue({ data: { organisation_id: "org-1" } });
    insert.mockResolvedValue({ error: null });
  });

  it("carries an honest error (while still reporting success) when the SAFETY-CRITICAL assessment fails", async () => {
    // The load-bearing assertions are the two toEqual/toMatch calls below —
    // this IS the sabotage check: without the safety-vs-inert split added
    // in this fix, the rejection would either (a) propagate to logVital's
    // outer catch, failing `success: true`, or (b) be silently absorbed
    // into a clean `{ success: true }` with no error, failing the error
    // assertion — both are exactly the two bugs this test exists to catch.
    assessHeartRateBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const result = await logVital(undefined, pulseFormData());

    expect(result?.success).toBe(true);
    expect(result?.error).toMatch(/could not finish checking/i);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({ extra: expect.objectContaining({ stage: "safety_assessment" }) })
    );
  });

  it("stays a clean success (no error) when only the INERT bookkeeping tail fails", async () => {
    assessHeartRateBestEffort.mockResolvedValue(undefined);
    assessHealthScoreBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const result = await logVital(undefined, pulseFormData());

    expect(result).toEqual({ success: true });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({ extra: expect.objectContaining({ stage: "post_insert_best_effort" }) })
    );
  });
});
