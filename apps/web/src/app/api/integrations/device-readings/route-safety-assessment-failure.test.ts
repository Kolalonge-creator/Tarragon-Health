/**
 * assessBpControlBestEffort/assessGlucoseBestEffort are documented "never
 * throws," but that isn't literally enforced by a try/catch inside either of
 * them (see the offline-resilience audit's §7.1 follow-up —
 * docs/OFFLINE_RESILIENCE_AUDIT.md, added on the separate, unmerged
 * fix/offline-low-bandwidth-resilience branch, not present here). Before this
 * fix, a genuine network/DB drop right after this route's own insert
 * succeeded would throw straight out of the route handler as an uncaught
 * exception — Next.js turns that into a 500, telling an integration partner
 * this write failed when the reading is in fact already stored, inviting a
 * blind partner-side retry that also wouldn't re-run the assessment anyway
 * (a replayed external_reading_id hits the 23505 dedupe branch and returns
 * early).
 *
 * These prove the fix: the route always responds 200 with `{ success: true }`
 * once the insert has landed, and a safety-critical assessment failure is
 * reported to Sentry AND surfaced as `safetyAssessmentFailed: true` rather
 * than a silent, unqualified success.
 */

jest.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));
const captureException = jest.fn();

const assessBpControlBestEffort = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({
  assessBpControlBestEffort: (...args: unknown[]) => assessBpControlBestEffort(...args),
}));
const assessGlucoseBestEffort = jest.fn();
jest.mock("@/lib/vitals/assess-glucose", () => ({
  assessGlucoseBestEffort: (...args: unknown[]) => assessGlucoseBestEffort(...args),
}));

jest.mock("@/lib/integrations/api-key", () => ({
  verifyApiKey: jest.fn().mockResolvedValue({ organisationId: "org-1", scopes: ["device_readings:write"] }),
  hasScope: () => true,
}));

const insert = jest.fn();
const patientMaybeSingle = jest.fn();
const deviceMaybeSingle = jest.fn();
const deviceUpdateEq = jest.fn();

jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: patientMaybeSingle }) }) }) }) };
      }
      if (table === "patient_devices") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: deviceMaybeSingle }) }) }),
          update: () => ({ eq: deviceUpdateEq }),
        };
      }
      if (table === "vitals_readings") {
        return { insert };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.tarragonhealth.ng/api/integrations/device-readings", {
    method: "POST",
    headers: { authorization: "Bearer th_live_abc123", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/integrations/device-readings — safety-assessment failure handling", () => {
  beforeEach(() => {
    captureException.mockReset();
    assessBpControlBestEffort.mockReset().mockResolvedValue(undefined);
    assessGlucoseBestEffort.mockReset().mockResolvedValue(undefined);
    patientMaybeSingle.mockResolvedValue({ data: { id: "patient-1" } });
    deviceMaybeSingle.mockResolvedValue({ data: { id: "device-1", status: "active" } });
    deviceUpdateEq.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });
  });

  it("still responds 200 success when assessBpControlBestEffort rejects, and flags it", async () => {
    // Sabotage check: without this fix's try/catch, this rejection would
    // propagate out of the route handler as an uncaught exception instead of
    // a normal Response — which is what would invite an unnecessary partner
    // retry of an already-stored reading.
    assessBpControlBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(
      request({
        patient_number: "TH-000123",
        device: { type: "bp_cuff", serial: "sn-1" },
        external_reading_id: "r1",
        taken_at: "2026-09-24T08:00:00.000Z",
        vital_type: "blood_pressure",
        systolic: 120,
        diastolic: 80,
      })
    );
    const body = (await res.json()) as { success: boolean; safetyAssessmentFailed?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, safetyAssessmentFailed: true });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1]).toEqual(
      expect.objectContaining({ extra: expect.objectContaining({ stage: "safety_assessment" }) })
    );
  });

  it("still responds 200 success when assessGlucoseBestEffort rejects, and flags it", async () => {
    assessGlucoseBestEffort.mockRejectedValue(new TypeError("fetch failed"));

    const res = await POST(
      request({
        patient_number: "TH-000123",
        device: { type: "glucometer", serial: "sn-2" },
        external_reading_id: "r2",
        taken_at: "2026-09-24T08:00:00.000Z",
        vital_type: "glucose",
        glucose_value: 5.5,
        glucose_unit: "mmol_l",
        glucose_context: "fasting",
      })
    );
    const body = (await res.json()) as { success: boolean; safetyAssessmentFailed?: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, safetyAssessmentFailed: true });
  });

  it("omits safetyAssessmentFailed on a clean run", async () => {
    const res = await POST(
      request({
        patient_number: "TH-000123",
        device: { type: "bp_cuff", serial: "sn-1" },
        external_reading_id: "r3",
        taken_at: "2026-09-24T08:00:00.000Z",
        vital_type: "blood_pressure",
        systolic: 120,
        diastolic: 80,
      })
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(captureException).not.toHaveBeenCalled();
  });
});
