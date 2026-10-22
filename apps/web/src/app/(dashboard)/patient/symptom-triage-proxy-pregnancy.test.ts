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
  });

  it("a proxy's other check never passes or records a 'pregnant' answer, and the loader is told it is a proxy", async () => {
    subjectOf = () => "p1";
    getActivePathway.mockResolvedValue({ pathway: headache, protocolVersion: 1 });
    const r = await stepSymptomTriage(input("headache", ["pregnant", "hypertension"], ["confusion"]));
    expect(r.status).toBe("complete");
    expect(getActivePathway.mock.calls[0]?.[2]).toEqual({ forProxy: true });
    const row = assessmentInsert.mock.calls[0]?.[0] as { initial_capture: { relevantHistory: string[] }; logged_by_profile_id: string };
    expect(row.logged_by_profile_id).toBe("u1");
    expect(row.initial_capture.relevantHistory).toEqual(["hypertension"]);
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
