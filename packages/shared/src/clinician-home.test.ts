import { describe, expect, it } from "@jest/globals";
import {
  countdownFor,
  escalationsForDoctor,
  figure,
  lagosDayBounds,
  nextActionView,
  pickNextAction,
  rankEscalations,
  sumFigures,
  type HomeEscalation,
} from "./clinician-home";

const NOW = new Date("2026-10-30T10:00:00Z");

const esc = (id: string, level: HomeEscalation["level"], dueAt: string | null): HomeEscalation => ({
  id,
  reason: "r",
  status: "open",
  patientName: "P",
  level,
  dueAt,
  assignedDoctorId: null,
});

describe("escalationsForDoctor", () => {
  const mine = { ...esc("mine", "routine", null), assignedDoctorId: "me" };
  const theirs = { ...esc("theirs", "emergency", null), assignedDoctorId: "colleague" };
  const unassigned = esc("free", "routine", null);

  it("keeps my cases and unassigned ones, drops a colleague's", () => {
    expect(escalationsForDoctor([mine, theirs, unassigned], "me").map((r) => r.id)).toEqual(["mine", "free"]);
  });
  it("with no known doctor id only unassigned cases remain", () => {
    expect(escalationsForDoctor([mine, theirs, unassigned], null).map((r) => r.id)).toEqual(["free"]);
  });
});

describe("rankEscalations", () => {
  it("puts the more severe level first whatever the due time", () => {
    const rows = [
      esc("routine-soon", "routine", "2026-10-30T10:05:00Z"),
      esc("emergency-late", "emergency", "2026-10-31T10:00:00Z"),
    ];
    expect(rankEscalations(rows).map((r) => r.id)).toEqual(["emergency-late", "routine-soon"]);
  });

  it("breaks a level tie by the nearest due time; no due time goes last", () => {
    const rows = [
      esc("none", "urgent_escalation", null),
      esc("later", "urgent_escalation", "2026-10-30T12:00:00Z"),
      esc("sooner", "urgent_escalation", "2026-10-30T10:30:00Z"),
    ];
    expect(rankEscalations(rows).map((r) => r.id)).toEqual(["sooner", "later", "none"]);
  });

  it("ranks a case with no alert as routine instead of dropping it, and keeps input order on a full tie", () => {
    const rows = [esc("a", null, null), esc("b", "routine", null), esc("c", "clinician_review", null)];
    expect(rankEscalations(rows).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("treats an unparseable due time as no due time", () => {
    const rows = [esc("bad", "routine", "not-a-date"), esc("good", "routine", "2026-10-30T11:00:00Z")];
    expect(rankEscalations(rows).map((r) => r.id)).toEqual(["good", "bad"]);
  });

  it("does not mutate its input", () => {
    const rows = [esc("b", "routine", null), esc("a", "emergency", null)];
    rankEscalations(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("countdownFor", () => {
  it("overdue", () => {
    expect(countdownFor("2026-10-30T07:50:00Z", NOW)).toEqual({ state: "overdue", label: "Overdue by 2 h 10 min" });
  });
  it("due soon under an hour", () => {
    expect(countdownFor("2026-10-30T10:45:00Z", NOW)).toEqual({ state: "due_soon", label: "Due in 45 min" });
  });
  it("on track", () => {
    expect(countdownFor("2026-10-30T14:00:00Z", NOW)).toEqual({ state: "on_track", label: "Due in 4 h" });
  });
  it("no due time", () => {
    expect(countdownFor(null, NOW).state).toBe("no_due_time");
  });
});

describe("nextActionView", () => {
  it("a failed load is unknown even when rows are present or absent", () => {
    expect(nextActionView([], true, NOW)).toEqual({ kind: "unknown" });
    expect(nextActionView([esc("a", "emergency", null)], true, NOW)).toEqual({ kind: "unknown" });
  });
  it("an empty successful load is clear", () => {
    expect(nextActionView([], false, NOW)).toEqual({ kind: "clear" });
  });
  it("counts the cases behind the first", () => {
    const view = nextActionView([esc("a", "routine", null), esc("b", "emergency", null), esc("c", "routine", null)], false, NOW);
    expect(view.kind === "action" && view.action.escalation.id).toBe("b");
    expect(view.kind === "action" && view.action.behind).toBe(2);
  });
  it("pickNextAction returns null for no rows", () => {
    expect(pickNextAction([], NOW)).toBeNull();
  });
});

describe("figure and sumFigures", () => {
  it("an errored count is unknown whatever number came back", () => {
    expect(figure(0, true)).toEqual({ state: "unknown" });
    expect(figure(null, false)).toEqual({ state: "unknown" });
  });
  it("zero from a good read is a known zero", () => {
    expect(figure(0, false)).toEqual({ state: "known", value: 0 });
  });
  it("a sum with one unknown part is unknown, not a partial total", () => {
    expect(sumFigures([figure(3, false), figure(null, true)])).toEqual({ state: "unknown" });
    expect(sumFigures([figure(3, false), figure(4, false)])).toEqual({ state: "known", value: 7 });
  });
});

describe("lagosDayBounds", () => {
  it("00:30 Lagos on the 31st is still the 31st (23:30Z on the 30th)", () => {
    const b = lagosDayBounds(new Date("2026-10-30T23:30:00Z"));
    expect(b.startIso).toBe("2026-10-30T23:00:00.000Z");
    expect(b.endIso).toBe("2026-10-31T23:00:00.000Z");
  });
  it("22:30Z is already the next Lagos day only after 23:00Z", () => {
    const b = lagosDayBounds(new Date("2026-10-30T22:30:00Z"));
    expect(b.startIso).toBe("2026-10-29T23:00:00.000Z");
  });
});
