/**
 * S44 (spec 2.13): the on-device health-store route stores nothing, and opens no connection, for a person whose wearable_device_data consent is
 * not in force. The consent lookup is the database's (`consent_in_force`, proved in packages/db/tests/s44_interoperability.sql: none, accepted,
 * withdrawn); this proves the route obeys it on both its calls and fails closed when the lookup itself fails.
 */
const ingestReadings = jest.fn();
jest.mock("@/lib/wearables/ingest", () => {
  const actual = jest.requireActual("@/lib/wearables/ingest");
  return { ...actual, ingestReadings: (...args: unknown[]) => ingestReadings(...args) };
});

const getUser = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({
    auth: { getUser: (...args: unknown[]) => getUser(...args) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => ({ data: { organisation_id: "org-1" } }) }) }) }),
  }),
}));

const rpc = jest.fn();
const fromService = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: (...args: unknown[]) => rpc(...args), from: (...args: unknown[]) => fromService(...args) }),
}));

import { GET, POST } from "./route";

function post(): Request {
  return new Request("https://app.tarragonhealth.ng/api/mobile/health-samples", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify({
      provider: "apple_health",
      samples: [{ reading_type: "blood_pressure", value: 120, secondary_value: 80, unit: "mmHg", recorded_at: "2026-09-24T08:00:00.000Z", external_reading_id: "r1" }],
    }),
  });
}

describe("health-samples route: wearable_device_data consent", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } }, error: null });
    rpc.mockReset();
    fromService.mockReset();
    ingestReadings.mockReset();
  });

  it("refuses an upload with 403 consent_required and touches no table when the consent is not in force", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("consent_required");
    expect(rpc).toHaveBeenCalledWith("consent_in_force", { p_patient: "patient-1", p_type: "wearable_device_data" });
    expect(fromService).not.toHaveBeenCalled();
    expect(ingestReadings).not.toHaveBeenCalled();
  });

  it("refuses the where-to-resume question too, so a person without consent never starts a read", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await GET(new Request("https://app.tarragonhealth.ng/api/mobile/health-samples?provider=apple_health", { headers: { authorization: "Bearer token-1" } }));
    expect(res.status).toBe(403);
    expect(fromService).not.toHaveBeenCalled();
  });

  it("fails closed when the consent lookup itself fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(ingestReadings).not.toHaveBeenCalled();
  });

  it("lets the upload through when the consent is in force", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    fromService.mockImplementation(() => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "connection-1" } }) }) }) }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));
    ingestReadings.mockResolvedValue({
      vitalsInserted: 1, wearableInserted: 0, implausible: 0, deniedByConsent: 0, consentDeniedSafetyRetained: 0, failed: 0,
      stepDaysRecorded: 0, stepDaysDeferredToManual: 0, safetyAssessmentFailed: false,
    });
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(ingestReadings).toHaveBeenCalledTimes(1);
  });
});
