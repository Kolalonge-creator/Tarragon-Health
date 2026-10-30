/**
 * The approval action must forward exactly the ids the person ticked to the
 * matching database function, never pick or default any itself, and surface
 * the database's own refusal (a non-CMO is refused there, not here).
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/ai-governance/run-coach-eval-suites", () => ({ runAiCoachGovernanceSuites: jest.fn() }));
jest.mock("@/lib/ai-governance/run-document-capture-eval-suites", () => ({ runAiDocumentCaptureEvalSuites: jest.fn() }));
jest.mock("@/lib/ai-governance/run-imaging-eval-suites", () => ({ runAiImagingReportEvalSuites: jest.fn() }));
jest.mock("@/lib/ai-governance/run-scribe-eval-suites", () => ({ runAiScribeEvalSuites: jest.fn() }));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentClinicalStaff: jest.fn(), getCurrentProfile: jest.fn() }));

const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }),
}));

import { approveAiGuardrailsAction, approveAiKnowledgeSourcesAction, reviewAiEvaluationRunAction } from "./actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

beforeEach(() => rpc.mockReset());

describe("approveAiKnowledgeSourcesAction", () => {
  it("sends exactly the ticked ids and the note to approve_ai_knowledge_sources", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const res = await approveAiKnowledgeSourcesAction(undefined, form([["ids", A], ["ids", B], ["note", "read both"]]));
    expect(rpc).toHaveBeenCalledWith("approve_ai_knowledge_sources", { p_ids: [A, B], p_note: "read both" });
    expect(res?.success).toContain("Approved 2");
  });
  it("refuses an empty selection without calling the database", async () => {
    const res = await approveAiKnowledgeSourcesAction(undefined, form([]));
    expect(res?.error).toMatch(/at least one/i);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses an id that is not a uuid", async () => {
    const res = await approveAiKnowledgeSourcesAction(undefined, form([["ids", "nope"]]));
    expect(res?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database refusal as it is", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "only the active Chief Medical Officer can approve AI knowledge sources" } });
    const res = await approveAiKnowledgeSourcesAction(undefined, form([["ids", A]]));
    expect(res?.error).toContain("Chief Medical Officer");
    expect(res?.success).toBeUndefined();
  });
});

describe("reviewAiEvaluationRunAction", () => {
  it("forwards the run and the outcome the person saw to review_ai_evaluation_run", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await reviewAiEvaluationRunAction(undefined, form([["runId", A], ["expectedOutcome", "fail"], ["note", "read the two failures"]]));
    expect(rpc).toHaveBeenCalledWith("review_ai_evaluation_run", { p_run_id: A, p_expected_outcome: "fail", p_note: "read the two failures" });
    expect(res?.success).toContain("under your name");
  });
  it("refuses a missing outcome or a run id that is not a uuid without calling the database", async () => {
    expect((await reviewAiEvaluationRunAction(undefined, form([["runId", A]])))?.error).toBeDefined();
    expect((await reviewAiEvaluationRunAction(undefined, form([["runId", "nope"], ["expectedOutcome", "pass"]])))?.error).toBeDefined();
    expect((await reviewAiEvaluationRunAction(undefined, form([["runId", A], ["expectedOutcome", "approved"]])))?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database refusal as it is (a non-CMO, or a result rescored since the page loaded)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "that run's outcome is fail, not pass: reload the result and try again" } });
    const res = await reviewAiEvaluationRunAction(undefined, form([["runId", A], ["expectedOutcome", "pass"]]));
    expect(res?.error).toContain("reload the result");
    expect(res?.success).toBeUndefined();
  });
});

describe("approveAiGuardrailsAction", () => {
  it("forwards the system code and the count the person read", async () => {
    rpc.mockResolvedValue({ data: 61, error: null });
    const res = await approveAiGuardrailsAction(undefined, form([["systemCode", "AI-002"], ["expectedCount", "61"], ["note", "read all"]]));
    expect(rpc).toHaveBeenCalledWith("approve_ai_guardrails", { p_system_code: "AI-002", p_expected_count: 61, p_note: "read all" });
    expect(res?.success).toContain("Approved 61");
  });
  it("refuses a missing or zero count without calling the database", async () => {
    const res = await approveAiGuardrailsAction(undefined, form([["systemCode", "AI-002"], ["expectedCount", "0"]]));
    expect(res?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows a count mismatch from the database as it is", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "AI-002 has 62 unapproved active guardrails, not 61: review the current list and try again" } });
    const res = await approveAiGuardrailsAction(undefined, form([["systemCode", "AI-002"], ["expectedCount", "61"]]));
    expect(res?.error).toContain("62");
  });
});
