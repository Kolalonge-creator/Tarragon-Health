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

import { approveAiItemsAction } from "./actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

beforeEach(() => rpc.mockReset());

describe("approveAiItemsAction", () => {
  it("sends the ticked guardrail ids and the note to approve_ai_guardrails", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const res = await approveAiItemsAction(undefined, form([["kind", "guardrails"], ["ids", A], ["ids", B], ["note", "read both"]]));
    expect(rpc).toHaveBeenCalledWith("approve_ai_guardrails", { p_ids: [A, B], p_note: "read both" });
    expect(res?.success).toContain("Approved 2");
  });

  it("uses the knowledge source function for knowledge sources", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    await approveAiItemsAction(undefined, form([["kind", "knowledge_sources"], ["ids", A]]));
    expect(rpc).toHaveBeenCalledWith("approve_ai_knowledge_sources", { p_ids: [A], p_note: undefined });
  });

  it("refuses an empty selection without calling the database", async () => {
    const res = await approveAiItemsAction(undefined, form([["kind", "guardrails"]]));
    expect(res?.error).toMatch(/at least one/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid", async () => {
    const res = await approveAiItemsAction(undefined, form([["kind", "guardrails"], ["ids", "nope"]]));
    expect(res?.error).toBeDefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database refusal as it is", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not authorised: only an active Chief Medical Officer can approve AI guardrails and knowledge sources" } });
    const res = await approveAiItemsAction(undefined, form([["kind", "guardrails"], ["ids", A]]));
    expect(res?.error).toContain("Chief Medical Officer");
    expect(res?.success).toBeUndefined();
  });
});
