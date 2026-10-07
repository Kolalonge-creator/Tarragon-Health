import { en } from "@tarragon/i18n";
import {
  COHORT_KINDS, KIND_KEYS, UNIT_KEYS, communityErrorKey, communityJoinPath, parseBoard, parseChallenges, parseInviteMade, parseMyCohorts, parseOk, parsePreview, parseRoster, tokenFromInput,
} from "./parse";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { contribute, createInvite, joinCohort, loadChallenges, loadMyCohorts } from "./api";

beforeEach(() => mockRpc.mockReset());

const challenge = {
  challenge_id: "c1", label: "Move together", unit: "minutes", starts_on: "2026-10-07", ends_on: "2026-10-20", phase: "active", available: true, contributing: true,
  total: { state: "shown", total: 1810, progress_pct: 100, goal_reached: true, group_size: "10-19", as_of: "2026-10-08", final: false },
};

describe("community parsing", () => {
  it("every kind and unit has copy", () => {
    for (const k of COHORT_KINDS) expect(en[KIND_KEYS[k]].length).toBeGreaterThan(0);
    for (const u of Object.values(UNIT_KEYS)) expect(en[u].length).toBeGreaterThan(0);
  });

  it("a challenge view drops any individual figure the reply carries (it cannot reach a screen)", () => {
    const parsed = parseChallenges([{ ...challenge, yours: 163, member_rank: 3, total: { ...challenge.total, mine: 163 } }]);
    expect(parsed).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toMatch(/163|yours|member_rank|mine/);
  });

  it("treats garbage as nothing to show", () => {
    expect(parseChallenges("x")).toEqual([]);
    expect(parseMyCohorts(undefined)).toEqual({ open: false, off: false, cohorts: [] });
    expect(parseBoard({ state: "boom" })).toEqual({ state: "hidden" });
    expect(parseRoster([{ member_id: 1 }])).toEqual([]);
    expect(parsePreview({ ok: true, name: "x", kind: "club" })).toEqual({ ok: false });
    expect(parseInviteMade({ token: "short", expires_at: "x" })).toBeNull();
    expect(parseOk(null).ok).toBe(false);
  });

  it("a board row carries a label, a rank and a percentage, never a cohort name", () => {
    const b = parseBoard({ state: "shown", rows: [{ label: "Group 2", rank: 2, progress_pct: 50, is_yours: false, cohort_name: "Grace Fellowship" }] });
    expect(JSON.stringify(b)).not.toContain("Grace");
  });

  it("reads the token from a pasted link or a bare token, and nothing else", () => {
    const token = "a".repeat(43);
    expect(tokenFromInput(`https://app.tarragonhealth.ng${communityJoinPath(token)}`)).toBe(token);
    expect(tokenFromInput(token)).toBe(token);
    expect(tokenFromInput("hello")).toBe("");
    expect(communityJoinPath("x")).not.toMatch(/wa\.me|whatsapp/i);
  });

  it("maps refusals to messages with a safe default", () => {
    expect(communityErrorKey("cohort_name_not_allowed")).toBe("community.error.cohort_name_not_allowed");
    expect(communityErrorKey("anything else")).toBe("community.error.unknown");
  });
});

describe("community api", () => {
  it("loads cohorts through the one RPC and parses the reply", async () => {
    mockRpc.mockResolvedValue({ data: { open: true, off: false, cohorts: [] }, error: null });
    expect(await loadMyCohorts()).toEqual({ ok: true, data: { open: true, off: false, cohorts: [] } });
    expect(mockRpc).toHaveBeenCalledWith("community_my_cohorts");
  });

  it("joining sends the token and the explicit yes, and nothing else", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, cohort_id: "c1" }, error: null });
    const r = await joinCohort("tok", true);
    expect(mockRpc).toHaveBeenCalledWith("community_join", { p_token: "tok", p_consent_join: true });
    expect(r.ok && r.result.cohortId).toBe("c1");
  });

  it("a contribution sends only the challenge and minutes, never a value for a logged metric", async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await contribute("c1");
    expect(mockRpc).toHaveBeenCalledWith("contribute_to_challenge", { p_challenge: "c1", p_minutes: undefined });
  });

  it("a refusal from the database becomes a message key", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "community_closed" } });
    const r = await createInvite("c1");
    expect(r).toEqual({ ok: false, errorKey: "community.error.closed" });
  });

  it("challenges fail soft", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await loadChallenges("c1")).ok).toBe(false);
  });
});
