import { COHORT_KINDS, communityErrorKey, communityJoinPath, parseBoard, parseChallenges, parseMyCohorts, parsePreview, parseRoster } from "./model";

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
    expect(parseBoard({ state: "boom" })).toEqual({ state: "hidden" });
    expect(parseRoster({})).toEqual([]);
    expect(parsePreview({ ok: true, name: "x", kind: "club" })).toEqual({ ok: false });
  });

  it("a board row has a label, a rank and a percentage only", () => {
    const b = parseBoard({ state: "shown", rows: [{ label: "Group 2", rank: 2, progress_pct: 50, is_yours: false, cohort_name: "Grace Fellowship" }] });
    expect(JSON.stringify(b)).not.toContain("Grace");
  });

  it("maps database refusals to messages, with a safe default", () => {
    expect(communityErrorKey("cohort_name_not_allowed")).toBe("community.error.cohort_name_not_allowed");
    expect(communityErrorKey("ERR: something odd")).toBe("community.error.unknown");
    expect(communityErrorKey(undefined)).toBe("community.error.unknown");
  });

  it("builds the join link from the token only, and no WhatsApp link exists", () => {
    expect(communityJoinPath("abc-DEF_123")).toBe("/patient/community/join/abc-DEF_123");
    expect(communityJoinPath("a/b")).toBe("/patient/community/join/a%2Fb");
    expect(communityJoinPath("x")).not.toMatch(/wa\.me|whatsapp/i);
  });

  it("offers the five kinds the spec names", () => {
    expect([...COHORT_KINDS]).toEqual(["church", "mosque", "union", "estate", "workplace"]);
  });
});
