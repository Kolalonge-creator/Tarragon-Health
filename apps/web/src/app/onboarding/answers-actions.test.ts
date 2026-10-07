/**
 * S41 server actions in onboarding/actions.ts: saveOnboardingAnswers (spec 1.10) and joinProgrammeCode (spec 1.8).
 * Pinned: invalid answers never reach the database; the code box gives the SAME answer for every failure of the code itself so
 * it cannot be used to probe which codes exist; a transport error is a different, retryable answer; a code is never sent
 * with a missing or oversize value; and answers drive where completing onboarding lands.
 */

const rpcMock = jest.fn();
const getUserMock = jest.fn();
const fromMock = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockImplementation(async () => ({
    auth: { getUser: getUserMock },
    rpc: rpcMock,
    from: fromMock,
  })),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: jest.fn() }));
jest.mock("@/lib/identity/provider", () => ({ verifyIdentity: jest.fn() }));
const redirectMock = jest.fn().mockImplementation((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirectMock(to) }));

import { completeOnboarding, joinProgrammeCode, saveOnboardingAnswers } from "./actions";

beforeEach(() => {
  rpcMock.mockReset();
  redirectMock.mockClear();
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "u1", user_metadata: {} } } });
});

describe("saveOnboardingAnswers", () => {
  it("sends valid answers through the RPC", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(saveOnboardingAnswers(["stay_ahead"], ["none"])).resolves.toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("save_onboarding_answers", { p_goals: ["stay_ahead"], p_conditions: ["none"] });
  });

  it("refuses invalid answers before any call", async () => {
    await expect(saveOnboardingAnswers(["made_up"], ["none"])).resolves.toEqual({ ok: false, reason: "invalid" });
    await expect(saveOnboardingAnswers(["stay_ahead"], ["none", "asthma"])).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reports a database failure without leaking its text", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "relation public.onboarding_answers secret" } });
    const r = await saveOnboardingAnswers(["stay_ahead"], ["none"]);
    expect(r).toEqual({ ok: false, reason: "failed" });
  });
});

describe("joinProgrammeCode", () => {
  it("joins with a good code", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, status: "joined", cohort_id: "c1" }, error: null });
    await expect(joinProgrammeCode("  abcd2345 ")).resolves.toEqual({ status: "joined" });
    expect(rpcMock).toHaveBeenCalledWith("join_cohort", { p_code: "abcd2345" });
  });

  it("says already for a repeat", async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, status: "already" }, error: null });
    await expect(joinProgrammeCode("ABCD2345")).resolves.toEqual({ status: "already" });
  });

  it("gives one answer for an unknown, expired, closed or full code", async () => {
    rpcMock.mockResolvedValue({ data: { ok: false }, error: null });
    const results = await Promise.all(["AAAA2222", "BBBB3333", "CCCC4444"].map((c) => joinProgrammeCode(c)));
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    expect(results[0]).toEqual({ status: "bad_code" });
  });

  it("treats a transport error as retryable, not as a bad code", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "function public.join_cohort does not exist" } });
    await expect(joinProgrammeCode("ABCD2345")).resolves.toEqual({ status: "error" });
  });

  it("does not call the database for an empty or oversize code", async () => {
    await expect(joinProgrammeCode("  ")).resolves.toEqual({ status: "bad_code" });
    await expect(joinProgrammeCode("x".repeat(21))).resolves.toEqual({ status: "bad_code" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("completeOnboarding lands from the answers", () => {
  function profileAndAnswers(answers: { question_code: string; answer: unknown }[] | null, receivesCare = true) {
    fromMock.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      chain.update = () => ({ eq: () => Promise.resolve({ error: null }) });
      chain.select = () => ({
        eq: () =>
          table === "onboarding_answers"
            ? Promise.resolve({ data: answers })
            : { single: () => Promise.resolve({ data: { receives_care: receivesCare } }) },
      });
      return chain;
    });
  }

  it("goes to the health check when that is the leading card", async () => {
    profileAndAnswers([
      { question_code: "goals", answer: ["screening_check"] },
      { question_code: "conditions", answer: ["none"] },
    ]);
    await expect(completeOnboarding()).rejects.toThrow("NEXT_REDIRECT:/patient/prevention#health-check");
  });

  it("goes home for someone managing a condition, even if they also want a check", async () => {
    profileAndAnswers([
      { question_code: "goals", answer: ["manage_condition", "screening_check"] },
      { question_code: "conditions", answer: ["hypertension"] },
    ]);
    await expect(completeOnboarding()).rejects.toThrow("NEXT_REDIRECT:/patient");
  });

  it("falls back to the marketing-link intent only when there are no answers", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "u1", user_metadata: { signup_intent: "health_check" } } } });
    profileAndAnswers([]);
    await expect(completeOnboarding()).rejects.toThrow("NEXT_REDIRECT:/patient/prevention#health-check");
  });
});
