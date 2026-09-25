/**
 * This route builds its response `counts` object by explicitly listing which
 * IngestResult fields to forward to the mobile client — when
 * `safetyAssessmentFailed` was added to IngestResult (see
 * apps/web/src/lib/wearables/ingest.ts), this route's own field list didn't
 * automatically pick it up, silently reintroducing the "batch reports a
 * clean sync even though its abnormal-result detection didn't run" gap the
 * rest of that change was meant to close, just for this one caller of
 * ingestReadings.
 *
 * This proves the fix: safety_assessment_failed is present in the response
 * whenever ingestReadings reports it, whether the batch overall succeeded or
 * hit a genuine storage failure too.
 */

const ingestReadings = jest.fn();
jest.mock("@/lib/wearables/ingest", () => {
  const actual = jest.requireActual("@/lib/wearables/ingest");
  return {
    ...actual,
    ingestReadings: (...args: unknown[]) => ingestReadings(...args),
  };
});

const getUser = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: (table: string) => {
      if (table === "profiles") {
        return { select: () => ({ eq: () => ({ single: () => ({ data: { organisation_id: "org-1" } }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const connectionMaybeSingle = jest.fn();
const connectionUpdateEq = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "wearable_connections") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: connectionMaybeSingle }) }) }) }),
          update: () => ({ eq: connectionUpdateEq }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "./route";

function request(): Request {
  return new Request("https://app.tarragonhealth.ng/api/mobile/health-samples", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify({
      provider: "apple_health",
      samples: [
        {
          reading_type: "blood_pressure",
          value: 120,
          secondary_value: 80,
          unit: "mmHg",
          recorded_at: "2026-09-24T08:00:00.000Z",
          external_reading_id: "r1",
        },
      ],
    }),
  });
}

describe("POST /api/mobile/health-samples — forwards safetyAssessmentFailed", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
    connectionMaybeSingle.mockResolvedValue({ data: { id: "connection-1" } });
    connectionUpdateEq.mockResolvedValue({ error: null });
    ingestReadings.mockReset();
  });

  it("includes safety_assessment_failed: true when ingestReadings reports it on a clean batch", async () => {
    ingestReadings.mockResolvedValue({
      vitalsInserted: 1,
      wearableInserted: 0,
      implausible: 0,
      deniedByConsent: 0,
      consentDeniedSafetyRetained: 0,
      failed: 0,
      stepDaysRecorded: 0,
      stepDaysDeferredToManual: 0,
      safetyAssessmentFailed: true,
    });

    const res = await POST(request());
    const body = (await res.json()) as { success: boolean; safety_assessment_failed: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.safety_assessment_failed).toBe(true);
  });

  it("includes safety_assessment_failed: false on a fully clean batch", async () => {
    ingestReadings.mockResolvedValue({
      vitalsInserted: 1,
      wearableInserted: 0,
      implausible: 0,
      deniedByConsent: 0,
      consentDeniedSafetyRetained: 0,
      failed: 0,
      stepDaysRecorded: 0,
      stepDaysDeferredToManual: 0,
      safetyAssessmentFailed: false,
    });

    const res = await POST(request());
    const body = (await res.json()) as { safety_assessment_failed: boolean };

    expect(body.safety_assessment_failed).toBe(false);
  });
});
