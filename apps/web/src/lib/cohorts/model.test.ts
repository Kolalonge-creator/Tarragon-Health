import { COHORT_KINDS, communityErrorKey, communityJoinPath, parseChallenges, parseMyCohorts, parsePreview, parseRoster } from "./model";

const shown = {
  challenge_id: "c1", label: "Move together", unit: "minutes", starts_on: "2026-10-07", ends_on: "2026-10-20", phase: "active", available: true, contributing: true,
  total: { state: "shown", total: 1810, progress_pct: 100, goal_reached: true, group_size: "10-19", as_of: "2026-10-08", final: false },
};

describe("community model", () => {
  it("parses a challenge view and drops any field the schema does not know (an individual value cannot reach a screen)", () => {
    const parsed = parseChallenges([{ ...shown, yours: 163, member_rank: 3, total: { ...shown.total, mine: 163 } }]);
    expect(parsed).toHaveLength(1);
    const text = JSON.stringify(parsed);
    expect(text).not.toContain("163");
    expect(text).not.toContain("yours");
    expect(text).not.toContain("member_rank");
  });

  it("treats a malformed reply as nothing to show", () => {
    expect(parseChallenges("nope")).toEqual([]);
    expect(parseChallenges([{ challenge_id: 1 }])).toEqual([]);
    expect(parseMyCohorts(null)).toEqual({ open: false, off: false, cohorts: [] });
    expect(parseRoster({})).toEqual([]);
    expect(parsePreview({ ok: true, name: "x", kind: "club" })).toEqual({ ok: false });
  });

  it("maps database refusals to messages, with a safe default", () => {
    expect(communityErrorKey("cohort_name_not_allowed")).toBe("community.error.cohort_name_not_allowed");
    expect(communityErrorKey("ERR: something odd")).toBe("community.error.unknown");
    expect(communityErrorKey(undefined)).toBe("community.error.unknown");
  });

  it("builds the join link from the token only, and no WhatsApp link exists", () => {
    expect(communityJoinPath("abc-DEF_123")).toBe("/patient/cohorts/join/abc-DEF_123");
    expect(communityJoinPath("a/b")).toBe("/patient/cohorts/join/a%2Fb");
    expect(communityJoinPath("x")).not.toMatch(/wa\.me|whatsapp/i);
  });

  it("offers the five kinds the spec names", () => {
    expect([...COHORT_KINDS]).toEqual(["church", "mosque", "union", "estate", "workplace"]);
  });
});
