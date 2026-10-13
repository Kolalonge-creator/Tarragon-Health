import { asConcernNotice, CONCERN_NOTICES, deadlines, readerCandidates, sortInbox, type InboxRow } from "./model";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const H = 3_600_000;
const iso = (offsetH: number) => new Date(NOW + offsetH * H).toISOString();
const mk = (o: Partial<InboxRow>): InboxRow => ({
  id: "11111111-1111-4111-8111-111111111111", raised_by: "11111111-1111-4111-8111-111111111111", raised_by_name: null, category: "patient_safety", severity: "low",
  description: "x".repeat(30), screen: null, task_id: null, state: "new", created_at: iso(-1), acknowledge_due_at: iso(47), respond_due_at: iso(335), overdue: false,
  escalated_at: null, incident_id: null, messages: [], ...o,
});

describe("deadlines", () => {
  it("a new concern counts down to the acknowledge deadline", () => {
    expect(deadlines(mk({}), NOW)).toEqual({ acknowledge: "open", respond: "open", hoursToNext: 47 });
  });
  it("an unacknowledged concern past its deadline is overdue", () => {
    const d = deadlines(mk({ acknowledge_due_at: iso(-5) }), NOW);
    expect(d.acknowledge).toBe("overdue");
    expect(d.hoursToNext).toBe(-5);
  });
  it("once acknowledged the reply deadline is the next one", () => {
    expect(deadlines(mk({ state: "acknowledged", acknowledge_due_at: iso(-30) }), NOW)).toEqual({ acknowledge: "done", respond: "open", hoursToNext: 335 });
  });
  it("a reply overdue is shown late", () => {
    expect(deadlines(mk({ state: "acknowledged", respond_due_at: iso(-2) }), NOW).respond).toBe("overdue");
  });
  it("responded and closed have nothing open", () => {
    expect(deadlines(mk({ state: "responded" }), NOW)).toEqual({ acknowledge: "done", respond: "done", hoursToNext: null });
    expect(deadlines(mk({ state: "closed" }), NOW).hoursToNext).toBeNull();
  });
});

describe("sortInbox", () => {
  it("overdue first, then new, then the rest, closed last", () => {
    const rows = [
      mk({ id: "c", state: "closed" }), mk({ id: "b", state: "acknowledged" }), mk({ id: "a", state: "new" }), mk({ id: "o", acknowledge_due_at: iso(-3) }),
    ];
    expect(sortInbox(rows, NOW).map((r) => r.id)).toEqual(["o", "a", "b", "c"]);
  });
  it("does not change its input", () => {
    const rows = [mk({ id: "b", state: "closed" }), mk({ id: "a" })];
    sortInbox(rows, NOW);
    expect(rows[0]?.id).toBe("b");
  });
});

describe("readerCandidates", () => {
  const a = { profile_id: "a", full_name: "A" }, b = { profile_id: "b", full_name: "B" }, c = { profile_id: "c", full_name: "C" };
  it("leaves out people already named and the lead", () => {
    expect(readerCandidates([a, b, c], [{ profile_id: "b", note: null }], "c")).toEqual([a]);
  });
});

describe("notices", () => {
  it("only fixed tokens are accepted, so a link cannot put its own words on the page", () => {
    for (const n of CONCERN_NOTICES) expect(asConcernNotice(n)).toBe(n);
    expect(asConcernNotice("<b>hello</b>")).toBeNull();
    expect(asConcernNotice(undefined)).toBeNull();
    expect(asConcernNotice("the staff member did X")).toBeNull();
  });
});
