/**
 * Regression test (S60 review finding, PR #1003): an URGENT symptom check result that could not be recorded used to raise only a
 * Sentry event. Nobody on the care team was told, so the patient's one prompt in the app was the only safety net. It must now open
 * the durable incident + follow-up task path (`report_unrecorded_symptom_check`), exactly as an emergency does, and a failure to
 * do even that must be loud rather than swallowed.
 */
const rpc = jest.fn();
const emergencyInsert = jest.fn();
const assessmentInsert = jest.fn();
const captureException = jest.fn();

jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "patient-1" } } }) },
    rpc: async () => ({ data: { status: "ok" }, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1", state: "Lagos" } }) }) }) }),
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => {
      if (table === "symptom_triage_assessments") return { insert: assessmentInsert };
      if (table === "emergency_events") return { insert: emergencyInsert };
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
    },
  }),
}));
jest.mock("@/lib/acting/acting-for", () => ({ resolveSubjectId: jest.fn().mockResolvedValue("patient-1") }));
jest.mock("@/lib/symptom-triage/protocol", () => ({
  isSymptomCheckerOpen: jest.fn().mockResolvedValue(true),
  getActivePathway: jest.fn().mockResolvedValue({ pathway: { key: "headache" }, protocolVersion: 1 }),
  getActiveTriageProtocolConfig: jest.fn().mockResolvedValue({ protocolVersion: 1, config: { pathways: [] } }),
}));

let nextCategory: "urgent" | "emergency" | "routine" = "urgent";
jest.mock("@/lib/symptom-triage/safe-run", () => ({
  runSymptomCheck: jest.fn(async () => ({
    category: nextCategory,
    clinicianReviewRequired: true,
    safetyNetMessageKey: "x",
    rationale: "r",
    redFlagScreen: { hasFlag: false, fired: [], brokenRules: [], topCategory: null },
    questionsAsked: [],
    degraded: false,
    floorRaised: false,
    raisedByRisk: [],
  })),
}));

import { stepSymptomTriage } from "./symptom-triage-actions";

const input = {
  capture: {
    presentingComplaintKey: "headache",
    onset: "gradual" as const,
    severity: 4,
    associatedSymptoms: [],
    triggers: [],
    relevantHistory: [],
    measurements: {},
  },
  answers: {},
  questionLog: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  assessmentInsert.mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: { message: "db down", code: "XX000" } }) }) });
  emergencyInsert.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: { ok: true, has_task: true }, error: null });
});

describe("an unrecorded result is never silent", () => {
  it("an URGENT result that cannot be saved opens the durable report, and the patient still gets the answer", async () => {
    nextCategory = "urgent";
    const r = await stepSymptomTriage(input);
    expect(r).toMatchObject({ status: "complete", category: "urgent", recorded: false });
    expect(rpc).toHaveBeenCalledWith("report_unrecorded_symptom_check", { p_patient: "patient-1", p_category: "urgent" });
    expect(emergencyInsert).not.toHaveBeenCalled();
  });

  it("an EMERGENCY result that cannot be saved writes the emergency event AND opens the durable report", async () => {
    nextCategory = "emergency";
    await stepSymptomTriage(input);
    expect(emergencyInsert).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("report_unrecorded_symptom_check", { p_patient: "patient-1", p_category: "emergency" });
  });

  it("a routine result that cannot be saved does not page anyone", async () => {
    nextCategory = "routine";
    await stepSymptomTriage(input);
    expect(rpc).not.toHaveBeenCalled();
    expect(emergencyInsert).not.toHaveBeenCalled();
  });

  it("if the durable report itself fails, that is reported loudly (not swallowed) and the patient still gets the answer", async () => {
    nextCategory = "urgent";
    rpc.mockResolvedValue({ data: null, error: { message: "rpc down" } });
    const r = await stepSymptomTriage(input);
    expect(r).toMatchObject({ status: "complete", category: "urgent" });
    const messages = captureException.mock.calls.map((c) => String((c[0] as Error).message));
    expect(messages.some((m) => m.includes("unrecorded symptom check report failed"))).toBe(true);
  });

  it("a report the database declines (ok false) is also loud", async () => {
    nextCategory = "urgent";
    rpc.mockResolvedValue({ data: { ok: false, reason: "unknown_patient" }, error: null });
    await stepSymptomTriage(input);
    const messages = captureException.mock.calls.map((c) => String((c[0] as Error).message));
    expect(messages.some((m) => m.includes("was not reported"))).toBe(true);
  });
});
