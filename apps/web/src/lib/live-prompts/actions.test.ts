const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { dismissLivePrompt, recordLivePrompt } from "./actions";

const enc = "11111111-1111-4111-8111-111111111111";
const pid = "22222222-2222-4222-8222-222222222222";

beforeEach(() => rpc.mockReset());

describe("recordLivePrompt", () => {
  it("sends only the phrase, the rule id and the rule version, never any transcript text", async () => {
    rpc.mockResolvedValue({ data: pid, error: null });
    await expect(recordLivePrompt({ encounterId: enc, phrase: "chest pain" })).resolves.toEqual({ ok: true, id: pid });
    expect(rpc).toHaveBeenCalledWith("record_live_prompt", { p_encounter: enc, p_phrase: "chest pain", p_rule_id: "written_question_danger_phrases", p_rule_version: 1 });
  });

  it("maps the guard refusal and the consent refusal to their own reasons", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x", hint: "go_live_guard:live_redflag_prompts_enabled" } });
    await expect(recordLivePrompt({ encounterId: enc, phrase: "chest pain" })).resolves.toEqual({ ok: false, reason: "guard_off" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x", hint: "consent_required" } });
    await expect(recordLivePrompt({ encounterId: enc, phrase: "chest pain" })).resolves.toEqual({ ok: false, reason: "no_consent" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(recordLivePrompt({ encounterId: enc, phrase: "chest pain" })).resolves.toEqual({ ok: false, reason: "failed" });
  });

  it("refuses bad input before calling the database, and an unreadable answer is a failure", async () => {
    await expect(recordLivePrompt({ encounterId: "nope", phrase: "chest pain" })).resolves.toEqual({ ok: false, reason: "failed" });
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(recordLivePrompt({ encounterId: enc, phrase: "chest pain" })).resolves.toEqual({ ok: false, reason: "failed" });
  });
});

describe("dismissLivePrompt", () => {
  it("dismisses, and reports a database refusal", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await expect(dismissLivePrompt(pid)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("dismiss_live_prompt", { p_prompt: pid });
    rpc.mockResolvedValueOnce({ error: { message: "no" } });
    await expect(dismissLivePrompt(pid)).resolves.toEqual({ ok: false });
    await expect(dismissLivePrompt("bad")).resolves.toEqual({ ok: false });
  });
});
