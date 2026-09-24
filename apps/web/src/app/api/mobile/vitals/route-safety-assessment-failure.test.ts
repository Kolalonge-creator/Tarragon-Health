/**
 * assessBpControlBestEffort/assessHeartRateBestEffort/assessGlucoseBestEffort
 * are documented "never throws," but that isn't literally enforced by a
 * try/catch inside any of them (see the offline-resilience audit's §7.1
 * follow-up — docs/OFFLINE_RESILIENCE_AUDIT.md, added on the separate,
 * unmerged fix/offline-low-bandwidth-resilience branch, not present here).
 * Before this fix, a genuine network/DB drop right after this
 * route's own insert succeeded would throw straight out of the route handler
 * as an uncaught exception — Next.js turns that into a 500 with no JSON body,
 * which apps/mobile's offline-vitals-queue.ts reads as "not synced" and keeps
 * retrying, even though the reading is already durably saved. Worse, that
 * retry hits the client_reading_id dedupe branch and returns early WITHOUT
 * ever re-running the assessment — so the 500 buys nothing.
 *
 * These prove the fix: the route always responds 200 with `{ success: true }`
 * once the insert has landed, a safety-critical assessment failure is
 * reported to Sentry AND surfaced as `safetyAssessmentFailed: true` (never a
 * silent, unqualified success), and the inert health-score refresh keeps
 * running independently of whether the safety assessment failed.
 */

jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));
const captureException = jest.fn();

const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({
  assessBpControlBestEffort: (...args: unknown[]) => assessBpControlBestEffort(...args),
}));
const assessHeartRateBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-heart-rate", () => ({
  assessHeartRateBestEffort: (...args: unknown[]) => assessHeartRateBestEffort(...args),
}));
const assessGlucoseBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-glucose", () => ({
  assessGlucoseBestEffort: (...args: unknown[]) => assessGlucoseBestEffort(...args),
}));
const assessHealthScoreBestEffort = jest.fn();
jest.mock("@/lib/health-score/assess-health-score", () => ({
  assessHealthScoreBestEffort: (...args: unknown[]) => assessHealthScoreBestEffort(...args),
}));

const insert = jest.fn();
const single = jest.fn();
const getUser = jest.fn();

jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single }) }) };
      }
      if (table === "vitals_readings") {
        return { insert };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: jest.fn(),
  }),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.tarragonhealth.ng/api/mobile/vitals", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/vitals — safety-assessment failure handling", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessBpControlBestEffort.mockReset().mockResolvedValue(undefined);
    assessHeartRateBestEffort.mockReset().mockResolvedValue(undefined);
    assessGlucoseBestEffort.mockReset().mockResolvedValue(undefined);
    assessHealthScoreBestEffort.mockReset().mockResolvedValue(undefined);
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
    single.mockResolvedValue({ data: { organisation_id: "org-1" } });
    insert.mockResolvedValue({ error: null });
  });

  it("still responds 200 success when assessBpControlBestEffort rejects, and flags it", async () => {
    // Sabotage check: without this fix's try/catch, this rejection would
    // propagate out of the route handler as an uncaught exception instead of
    // a normal Response.
    assessBpControlBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(request({ vital_type: "blood_pressure", systolic: 120, diastolic: 80 }));
    const body = (await res.json()) as { success: boolean; safetyAssessmentFailed?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, safetyAssessmentFailed: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({ extra: expect.objectContaining({ stage: "safety_assessment" }) })
    );
    // The inert bookkeeping call still runs independently of the safety-check failure.
    expect(assessHealthScoreBestEffort).toHaveBeenCalledTimes(1);
  });

  it("still responds 200 success when assessHeartRateBestEffort rejects, and flags it", async () => {
    assessHeartRateBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(request({ vital_type: "pulse", pulse_bpm: 72 }));
    const body = (await res.json()) as { success: boolean; safetyAssessmentFailed?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, safetyAssessmentFailed: true });
  });

  it("still responds 200 success when assessGlucoseBestEffort rejects, and flags it", async () => {
    assessGlucoseBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(
      request({ vital_type: "glucose", glucose_value: 5.5, glucose_unit: "mmol_l", glucose_context: "fasting" })
    );
    const body = (await res.json()) as { success: boolean; safetyAssessmentFailed?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, safetyAssessmentFailed: true });
  });

  it("omits safetyAssessmentFailed on a clean run", async () => {
    const res = await POST(request({ vital_type: "pulse", pulse_bpm: 72 }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
  });

  it("still runs the inert health-score refresh even when the safety assessment failed", async () => {
    assessGlucoseBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    await POST(
      request({ vital_type: "glucose", glucose_value: 5.5, glucose_unit: "mmol_l", glucose_context: "fasting" })
    );

    expect(assessHealthScoreBestEffort).toHaveBeenCalledTimes(1);
    // Two distinct Sentry reports would indicate the inert catch also fired,
    // which it shouldn't when the health-score call itself succeeds.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("reports the inert health-score failure separately (Sentry-only) from a safety-check failure", async () => {
    assessHealthScoreBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(request({ vital_type: "pulse", pulse_bpm: 72 }));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({ extra: expect.objectContaining({ stage: "post_insert_best_effort" }) })
    );
  });
});
