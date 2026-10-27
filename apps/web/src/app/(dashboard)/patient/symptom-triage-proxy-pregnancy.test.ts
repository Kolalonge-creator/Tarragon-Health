import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { SEED_PATHWAYS, S59D_DRAFT_PATHWAYS } from "@tarragon/symptom-triage-engine";

/**
 * OQ-S59d-05 (decided): pregnancy answers are the person's own. A carer who runs the check for someone else (acting-for) cannot run
 * the pregnancy pathway and cannot pass a "pregnant" answer to the engine or the record; the result is a plain message and the normal
 * emergency guidance. The person themselves is unaffected.
 */
let subjectOf = (id: string) => id;
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: null }>>();
const assessmentInsert = jest.fn<(row: Record<string, unknown>) => unknown>();
const serviceRpc = jest.fn<(fn: string, args?: Record<string, unknown>) => void>();
const getActivePathway = jest.fn<(key: string, client?: unknown, options?: { forProxy?: boolean }) => Promise<unknown>>();

jest.mock("@sentry/nextjs", () => ({ captureException: () => undefined }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "o1", state: "Lagos" } }) }) }) }),
  }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      serviceRpc(fn, args);
      return { data: { ok: true }, error: null };
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organisation_id: "o1" } }) }) }),
      insert: (row: Record<string, unknown>) => {
        assessmentInsert(row);
        return { select: () => ({ single: async () => ({ data: { id: "a1" }, error: null }) }) };
      },
    }),
  }),
}));
jest.mock("@/lib/acting/acting-for", () => ({ resolveSubjectId: async (id: string) => subjectOf(id) }));
jest.mock("@/lib/symptom-triage/protocol", () => {
  const actual = jest.requireActual("@/lib/symptom-triage/protocol") as Record<string, unknown>;
  return {
    ...actual,
    isSymptomCheckerOpen: async () => true,
    getActivePathway: (k: string, c?: unknown, o?: { forProxy?: boolean }) => getActivePathway(k, c, o),
    getActiveTriageProtocolConfig: async () => ({ config: { version: 1, pathways: [...SEED_PATHWAYS, ...S59D_DRAFT_PATHWAYS] }, protocolVersion: 1 }),
  };
});

import { stepSymptomTriage } from "./symptom-triage-actions";

const headache = SEED_PATHWAYS.find((p) => p.key === "headache")!;
const pregnancy = S59D_DRAFT_PATHWAYS.find((p) => p.key === "pregnancy_danger_signs")!;
const input = (key: string, history: string[], symptoms: string[] = []) =>
  ({ capture: { presentingComplaintKey: key, onset: "gradual", severity: 3, associatedSymptoms: symptoms, triggers: [], relevantHistory: history, measurements: {} }, answers: {}, questionLog: [] }) as unknown as Parameters<typeof stepSymptomTriage>[0];

beforeEach(() => {
  rpc.mockReset();
  assessmentInsert.mockReset();
  serviceRpc.mockReset();
  getActivePathway.mockReset();
  subjectOf = (id) => id;
  rpc.mockImplementation(async (fn) => (fn === "symptom_checker_eligibility" ? { data: { status: "ok" }, error: null } : { data: true, error: null }));
});

describe("pregnancy answers are the person's own", () => {
  it("a PROXY attempt at the pregnancy pathway is blocked with the plain message, runs nothing and records nothing", async () => {
    subjectOf = () => "p1"; // u1 is acting for p1
    getActivePathway.mockResolvedValue({ pathway: pregnancy, protocolVersion: 1 });
    const r = await stepSymptomTriage(input("pregnancy_danger_signs", [], ["seizure"]));
    expect(r).toEqual({ status: "blocked", reason: "pregnancy_self_only" });
    expect(getActivePathway).not.toHaveBeenCalled();
    expect(assessmentInsert).not.toHaveBeenCalled();
    // the care team is still told through the durable path (incident plus follow-up), with no condition named
    expect(serviceRpc).toHaveBeenCalledWith("report_unrecorded_symptom_check", { p_patient: "p1", p_category: "urgent" });
  });

  it("a proxy ticking 'pregnant' on another check is NOT stored, but still raises the result to at least urgent (review fix)", async () => {
    subjectOf = () => "p1";
    getActivePathway.mockResolvedValue({ pathway: headache, protocolVersion: 1 });
    // a headache at severity 6 with pregnancy fires headache.pregnancy_severe (urgent): the proxy must get what the person would
    const r = await stepSymptomTriage({ ...input("headache", ["pregnant", "hypertension"]), capture: { ...input("headache", ["pregnant", "hypertension"]).capture, severity: 6 } });
    expect(r.status).toBe("complete");
    if (r.status !== "complete") return;
    expect(r.category).toBe("urgent");
    expect(r.proxyPregnancyNote).toBe(true);
    expect(getActivePathway.mock.calls[0]?.[2]).toEqual({ forProxy: true });
    const row = assessmentInsert.mock.calls[0]?.[0] as { initial_capture: { relevantHistory: string[] }; logged_by_profile_id: string; category: string };
    expect(row.logged_by_profile_id).toBe("u1");
    expect(row.category).toBe("urgent");
    expect(row.initial_capture.relevantHistory).toEqual(["hypertension"]);
  });

  it("a calm check with pregnancy ticked by a proxy is floored at urgent; without the tick it is not", async () => {
    subjectOf = () => "p1";
    getActivePathway.mockResolvedValue({ pathway: headache, protocolVersion: 1 });
    const calm = { ...input("headache", []), answers: { duration_check: false, frequency_check: false, severity_check: "mild" } };
    const without = await stepSymptomTriage(calm as never);
    expect(without.status === "complete" && without.category).toBe("self_management");
    const ticked = await stepSymptomTriage({ ...calm, capture: { ...calm.capture, relevantHistory: ["pregnant"] } } as never);
    expect(ticked.status === "complete" && ticked.category).toBe("urgent");
  });

  it("the person themselves can still run the pregnancy pathway and answer 'pregnant'", async () => {
    getActivePathway.mockResolvedValue({ pathway: pregnancy, protocolVersion: 1 });
    const r = await stepSymptomTriage(input("pregnancy_danger_signs", ["pregnant"], ["seizure"]));
    expect(r.status).toBe("complete");
    expect(getActivePathway.mock.calls[0]?.[2]).toEqual({ forProxy: false });
    const row = assessmentInsert.mock.calls[0]?.[0] as { initial_capture: { relevantHistory: string[] }; logged_by_profile_id: null };
    expect(row.logged_by_profile_id).toBeNull();
    expect(row.initial_capture.relevantHistory).toEqual(["pregnant"]);
  });
});
