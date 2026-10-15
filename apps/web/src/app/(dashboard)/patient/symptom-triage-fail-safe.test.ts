import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { SEED_PATHWAYS } from "@tarragon/symptom-triage-engine";

/**
 * S60 acceptance test (spec 12.8, INV-01, INV-06): chest pain with sweating returns EMERGENCY even if the engine fails.
 * This runs the real server action end to end with the guard open, and breaks the engine in each way it can break:
 * a corrupt protocol that makes the interpreter throw, a protocol that cannot be read, a protocol that no longer lists the
 * complaint. In every case the patient gets an emergency, the fallback emergency event is written when the row cannot be
 * recorded, and a closed guard still answers nothing.
 */

type RpcResult = Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
let profileLookup: () => Promise<{ data: unknown }> = async () => ({ data: { organisation_id: "o1", state: "Lagos" } });
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => RpcResult>();
const assessmentInsert = jest.fn<(row: Record<string, unknown>) => unknown>();
const emergencyInsert = jest.fn<(row: Record<string, unknown>) => unknown>();
const captureException = jest.fn();
const getActivePathway = jest.fn<(key: string) => Promise<unknown>>();
const getActiveTriageProtocolConfig = jest.fn<() => Promise<unknown>>();

jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: () => profileLookup() }) }) }),
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "profiles" ? { organisation_id: "o1" } : null }) }) }),
      insert: (row: Record<string, unknown>) => {
        if (table === "emergency_events") {
          const r = emergencyInsert(row);
          return Promise.resolve(r ?? { error: null });
        }
        const r = assessmentInsert(row) as { data?: unknown; error?: unknown } | undefined;
        return { select: () => ({ single: async () => r ?? { data: { id: "a1" }, error: null } }) };
      },
    }),
  }),
}));
jest.mock("@/lib/acting/acting-for", () => ({ resolveSubjectId: async (id: string) => id }));
jest.mock("@/lib/symptom-triage/protocol", () => {
  const actual = jest.requireActual("@/lib/symptom-triage/protocol") as Record<string, unknown>;
  return {
    ...actual,
    getActivePathway: (k: string) => getActivePathway(k),
    getActiveTriageProtocolConfig: () => getActiveTriageProtocolConfig(),
  };
});

import { stepSymptomTriage, requestSymptomReview } from "./symptom-triage-actions";

const chest = SEED_PATHWAYS.find((p) => p.key === "chest_pain")!;
const sweating = {
  capture: {
    presentingComplaintKey: "chest_pain",
    onset: "gradual",
    severity: 7,
    associatedSymptoms: ["sweating"],
    triggers: [],
    relevantHistory: [],
    measurements: {},
  },
  answers: {},
  questionLog: [],
} as unknown as Parameters<typeof stepSymptomTriage>[0];

beforeEach(() => {
  rpc.mockReset();
  assessmentInsert.mockReset();
  emergencyInsert.mockReset();
  captureException.mockReset();
  getActivePathway.mockReset();
  getActiveTriageProtocolConfig.mockReset();
  profileLookup = async () => ({ data: { organisation_id: "o1", state: "Lagos" } });
  rpc.mockResolvedValue({ data: true, error: null }); // the guard is open
  getActiveTriageProtocolConfig.mockResolvedValue({ config: { pathways: [chest] }, protocolVersion: 1 });
});

describe("chest pain with sweating returns emergency even if the engine fails", () => {
  it("control: a healthy engine returns emergency and records the check", async () => {
    getActivePathway.mockResolvedValue({ pathway: chest, protocolVersion: 1 });
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", degraded: false, recorded: true });
    expect(assessmentInsert).toHaveBeenCalledTimes(1);
  });

  it("a corrupt protocol makes the interpreter throw: still emergency, marked degraded, recorded for review", async () => {
    getActivePathway.mockResolvedValue({ pathway: { ...chest, redFlagScreen: null }, protocolVersion: 1 });
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", degraded: true, clinicianReviewRequired: true });
    const row = assessmentInsert.mock.calls[0]?.[0];
    expect(row).toMatchObject({ category: "emergency", clinician_review_required: true });
  });

  it("an unreadable protocol (the database errors): still emergency", async () => {
    getActivePathway.mockRejectedValue(new Error("db down"));
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", degraded: true });
  });

  it("a protocol that no longer lists the complaint: still emergency, never 'unavailable'", async () => {
    getActivePathway.mockResolvedValue(null);
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", degraded: true });
  });

  it("when the check cannot be recorded the patient still gets the emergency, the failure is reported, and the emergency event is raised directly", async () => {
    getActivePathway.mockResolvedValue({ pathway: { ...chest, redFlagScreen: null }, protocolVersion: 1 });
    assessmentInsert.mockReturnValue({ data: null, error: { message: "trigger blew up", code: "P0001" } });
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", recorded: false, assessmentId: null });
    expect(captureException).toHaveBeenCalled();
    expect(emergencyInsert).toHaveBeenCalledTimes(1);
    expect(emergencyInsert.mock.calls[0]?.[0]).toMatchObject({ source: "symptom_triage", status: "active", patient_id: "u1" });
  });

  it("with no protocol version at all it still answers and still raises the emergency", async () => {
    getActivePathway.mockResolvedValue(null);
    getActiveTriageProtocolConfig.mockResolvedValue(null);
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", recorded: false });
    expect(assessmentInsert).not.toHaveBeenCalled();
    expect(emergencyInsert).toHaveBeenCalledTimes(1);
  });

  it("when the person's profile cannot be read the patient still gets the emergency, and the emergency event is still raised (organisation found with the service role)", async () => {
    getActivePathway.mockResolvedValue({ pathway: chest, protocolVersion: 1 });
    profileLookup = async () => {
      throw new Error("profile lookup failed");
    };
    const r = await stepSymptomTriage(sweating);
    expect(r).toMatchObject({ status: "complete", category: "emergency", recorded: false, assessmentId: null });
    expect(captureException).toHaveBeenCalled();
    expect(assessmentInsert).not.toHaveBeenCalled();
    expect(emergencyInsert).toHaveBeenCalledTimes(1);
    expect(emergencyInsert.mock.calls[0]?.[0]).toMatchObject({ source: "symptom_triage", organisation_id: "o1", patient_id: "u1" });
  });

  it("a broken engine with no red flag is urgent with human review, never reassurance", async () => {
    getActivePathway.mockResolvedValue({ pathway: { ...chest, redFlagScreen: null }, protocolVersion: 1 });
    const quiet = { ...sweating, capture: { ...sweating.capture, severity: 2, associatedSymptoms: [] } } as unknown as Parameters<typeof stepSymptomTriage>[0];
    const r = await stepSymptomTriage(quiet);
    expect(r).toMatchObject({ status: "complete", category: "urgent", degraded: true, clinicianReviewRequired: true });
  });

  it("SABOTAGE: the fail-safe is what saves it. A bare interpreter on the same corrupt protocol throws", async () => {
    const { runTriage } = await import("@tarragon/symptom-triage-engine");
    expect(() => runTriage({ ...chest, redFlagScreen: null } as never, sweating.capture as never, {}, [])).toThrow();
  });
});

describe("the closed guard is never bypassed by the fail-safe", () => {
  it("answers unavailable and records and raises nothing, even for chest pain with sweating, even with the engine broken", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    getActivePathway.mockResolvedValue({ pathway: { ...chest, redFlagScreen: null }, protocolVersion: 1 });
    await expect(stepSymptomTriage(sweating)).resolves.toEqual({ status: "unavailable" });
    expect(assessmentInsert).not.toHaveBeenCalled();
    expect(emergencyInsert).not.toHaveBeenCalled();
    expect(getActivePathway).not.toHaveBeenCalled();
  });

  it("a review cannot be requested while the checker is closed, and the database is not asked", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(requestSymptomReview("11111111-1111-1111-1111-111111111111")).resolves.toEqual({ status: "unavailable" });
    expect(rpc).not.toHaveBeenCalledWith("request_symptom_review", expect.anything());
  });

  it("a malformed assessment id is refused before anything is called", async () => {
    await expect(requestSymptomReview("not-an-id")).resolves.toEqual({ status: "error" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("asking for a review", () => {
  it("passes the id to the database function and reports the stated time it returns (never one of its own)", async () => {
    rpc.mockImplementation(async (fn) =>
      fn === "request_symptom_review" ? { data: { review_id: "r1", stated_minutes: null }, error: null } : { data: true, error: null },
    );
    await expect(requestSymptomReview("11111111-1111-1111-1111-111111111111")).resolves.toEqual({ status: "requested", stated: { stated: false } });
    rpc.mockImplementation(async (fn) =>
      fn === "request_symptom_review" ? { data: { review_id: "r1", stated_minutes: 1440 }, error: null } : { data: true, error: null },
    );
    await expect(requestSymptomReview("11111111-1111-1111-1111-111111111111")).resolves.toEqual({ status: "requested", stated: { stated: true, minutes: 1440 } });
  });

  it("a refusal from the database (not yours, or closed) reads as unavailable", async () => {
    rpc.mockImplementation(async (fn) =>
      fn === "request_symptom_review" ? { data: null, error: { message: "not found", code: "42501" } } : { data: true, error: null },
    );
    await expect(requestSymptomReview("11111111-1111-1111-1111-111111111111")).resolves.toEqual({ status: "unavailable" });
  });
});
