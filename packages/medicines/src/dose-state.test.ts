import { describe, expect, it } from "@jest/globals";
import { canUndo, effectiveLog, isClosed, isDoubleTap, resolveTakenTime, slotState, takenStatus } from "./dose-state";
import type { DoseLog } from "./types";

const MIN = 60_000;
const due = Date.parse("2026-10-05T07:00:00Z"); // 08:00 Lagos
const log = (status: DoseLog["status"], source: DoseLog["source"], at: number): DoseLog => ({ status, source, loggedAtMs: at });

describe("effectiveLog", () => {
  it("is null with no logs", () => expect(effectiveLog([])).toBeNull());
  it("takes the latest log", () => {
    const a = log("skipped", "patient", due + 10);
    const b = log("taken", "patient", due + 20);
    expect(effectiveLog([b, a])).toBe(b);
    expect(effectiveLog([a, b])).toBe(b);
  });
  it("a late-synced taken beats the server's missed even though the missed row is newer", () => {
    const taken = log("taken", "patient", due + 5 * MIN); // device time, offline
    const missed = log("missed", "system", due + 6 * 60 * MIN); // written by the job hours later
    expect(effectiveLog([taken, missed])).toBe(taken);
    expect(effectiveLog([missed, taken])).toBe(taken);
  });
  it("a server missed row is used when it is the only answer", () => {
    const missed = log("missed", "system", due);
    expect(effectiveLog([missed])).toBe(missed);
  });
  it("a patient-written missed row is a real answer and the latest wins", () => {
    const missed = log("missed", "patient", due + 1);
    const taken = log("taken", "patient", due + 2);
    expect(effectiveLog([missed, taken])).toBe(taken);
  });
  it("a duplicate log at the same instant resolves to the later one in the list", () => {
    const a = log("taken", "patient", due);
    const b = log("skipped", "patient", due);
    expect(effectiveLog([a, b])).toBe(b);
  });
  it("a null-source row counts as written by a person", () => {
    const old = log("missed", null, due + 9);
    const sys = log("missed", "system", due + 99);
    expect(effectiveLog([old, sys])).toBe(old);
  });
});

describe("slotState", () => {
  it("is upcoming, due, then missed on the clock alone", () => {
    expect(slotState(due, [], due - 1, 120)).toBe("upcoming");
    expect(slotState(due, [], due, 120)).toBe("due");
    expect(slotState(due, [], due + 119 * MIN, 120)).toBe("due");
    expect(slotState(due, [], due + 120 * MIN, 120)).toBe("missed");
  });
  it("maps every logged status", () => {
    expect(slotState(due, [log("taken", "patient", due)], due, 120)).toBe("taken");
    expect(slotState(due, [log("delayed", "patient", due)], due, 120)).toBe("late");
    expect(slotState(due, [log("skipped", "patient", due)], due, 120)).toBe("skipped");
    expect(slotState(due, [log("missed", "system", due)], due, 120)).toBe("missed");
    expect(slotState(due, [log("not_available", "patient", due)], due, 120)).toBe("unavailable");
  });
  it("a dose taken early is taken before it is due", () => {
    expect(slotState(due, [log("taken", "patient", due - 30 * MIN)], due - 10 * MIN, 120)).toBe("taken");
  });
});

describe("isClosed", () => {
  it("closed means the patient has answered", () => {
    for (const s of ["taken", "late", "skipped", "unavailable"] as const) expect(isClosed(s)).toBe(true);
    for (const s of ["upcoming", "due", "missed"] as const) expect(isClosed(s)).toBe(false);
  });
});

describe("resolveTakenTime", () => {
  const now = due + 10 * 60 * MIN;
  it("accepts a past time and clamps a small skew to now", () => {
    expect(resolveTakenTime(due, now, 72, 5)).toEqual({ ok: true, atMs: due });
    expect(resolveTakenTime(now + 3 * MIN, now, 72, 5)).toEqual({ ok: true, atMs: now });
  });
  it("refuses the future and anything older than the window", () => {
    expect(resolveTakenTime(now + 6 * MIN, now, 72, 5)).toEqual({ ok: false, reason: "in_future" });
    expect(resolveTakenTime(now - 73 * 60 * MIN, now, 72, 5)).toEqual({ ok: false, reason: "outside_window" });
  });
});

describe("takenStatus", () => {
  it("is taken inside the window and delayed after it", () => {
    expect(takenStatus(due, due + 120 * MIN, 120)).toBe("taken");
    expect(takenStatus(due, due + 121 * MIN, 120)).toBe("delayed");
    expect(takenStatus(due, due - 60 * MIN, 120)).toBe("taken");
  });
});

describe("undo and double-tap guard", () => {
  it("allows undo only inside the window and never for a future timestamp", () => {
    expect(canUndo(1000, 1000 + 119_000, 120)).toBe(true);
    expect(canUndo(1000, 1000 + 120_000, 120)).toBe(false);
    expect(canUndo(1000, 500, 120)).toBe(false);
  });
  it("treats a second tap inside the guard as a duplicate", () => {
    expect(isDoubleTap(null, 1000, 800)).toBe(false);
    expect(isDoubleTap(1000, 1500, 800)).toBe(true);
    expect(isDoubleTap(1000, 1800, 800)).toBe(false);
    expect(isDoubleTap(2000, 1000, 800)).toBe(false);
  });
});
