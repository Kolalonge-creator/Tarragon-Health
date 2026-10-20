import { describe, expect, it } from "@jest/globals";
import { nafdacNumberToStore, NAFDAC_GREENBOOK_URL, NAFDAC_VERIFY_STEP_KEYS } from "./nafdac-verify";
import { parseSupporterDoses, supporterDoseState, type SupporterDoseRow } from "./supporter-doses";
import { refillHandoff } from "./refill-handoff";

describe("nafdacNumberToStore", () => {
  it("stores a canonical number, clears on blank, refuses free text", () => {
    expect(nafdacNumberToStore(" a4-1234 ")).toEqual({ ok: true, value: "A4-1234" });
    expect(nafdacNumberToStore("NAFDAC Reg. No. 04-1234")).toEqual({ ok: true, value: "04-1234" });
    expect(nafdacNumberToStore("   ")).toEqual({ ok: true, value: null });
    expect(nafdacNumberToStore("it is genuine")).toEqual({ ok: false, reason: "not_a_nafdac_number" });
  });
  it("points only at NAFDAC's own channels", () => {
    expect(NAFDAC_GREENBOOK_URL).toBe("https://greenbook.nafdac.gov.ng");
    expect(NAFDAC_VERIFY_STEP_KEYS).toHaveLength(3);
  });
});

const row = (answer: SupporterDoseRow["answer"], dueAtMs = 1000): SupporterDoseRow => ({ medicationId: "m", name: "N", time: "08:00", dueAtMs, answer });

describe("supporterDoseState", () => {
  it("reads the answer, never 'missed'", () => {
    expect(supporterDoseState(row("taken"), 0)).toBe("taken");
    expect(supporterDoseState(row("delayed"), 0)).toBe("taken");
    expect(supporterDoseState(row("skipped"), 0)).toBe("skipped");
    expect(supporterDoseState(row("not_available"), 0)).toBe("skipped");
    expect(supporterDoseState(row("none"), 999)).toBe("not_due_yet");
    expect(supporterDoseState(row("none"), 1000)).toBe("no_record_yet");
    expect(supporterDoseState(row("missed"), 5000)).toBe("no_record_yet");
  });
});

describe("parseSupporterDoses", () => {
  const good = { status: "ok", date: "2026-10-20", doses: [{ medication_id: "m", name: "N", time: "08:00", due_at: "2026-10-20T07:00:00Z", answer: "taken" }] };
  it("reads the three answers", () => {
    expect(parseSupporterDoses(good)).toEqual({ status: "ok", date: "2026-10-20", doses: [{ medicationId: "m", name: "N", time: "08:00", dueAtMs: Date.parse("2026-10-20T07:00:00Z"), answer: "taken" }] });
    expect(parseSupporterDoses({ status: "not_shared" })).toEqual({ status: "not_shared" });
    expect(parseSupporterDoses({ status: "closed" })).toEqual({ status: "closed" });
    expect(parseSupporterDoses({ status: "ok", date: "d", doses: [] })).toEqual({ status: "ok", date: "d", doses: [] });
  });
  it("treats anything unexpected as unreadable, never as nothing due", () => {
    expect(parseSupporterDoses(null)).toEqual({ status: "unreadable" });
    expect(parseSupporterDoses([])).toEqual({ status: "unreadable" });
    expect(parseSupporterDoses({ status: "denied" })).toEqual({ status: "unreadable" });
    expect(parseSupporterDoses({ status: "ok", date: 1, doses: [] })).toEqual({ status: "unreadable" });
    expect(parseSupporterDoses({ status: "ok", date: "d", doses: "x" })).toEqual({ status: "unreadable" });
    expect(parseSupporterDoses({ status: "ok", date: "d", doses: [3] })).toEqual({ status: "unreadable" });
    const d = good.doses[0];
    for (const bad of [{ ...d, medication_id: 1 }, { ...d, name: 1 }, { ...d, time: 1 }, { ...d, due_at: "nope" }, { ...d, due_at: 5 }, { ...d, answer: "gone" }, { ...d, answer: 1 }]) {
      expect(parseSupporterDoses({ ...good, doses: [bad] })).toEqual({ status: "unreadable" });
    }
  });
});

describe("refillHandoff", () => {
  const input = { low: true, prescriptionId: "rx1", patientId: "p1", collectionOpen: true as boolean | null };
  it("offers the existing S28 page only when low, prescribed and the flow is open", () => {
    expect(refillHandoff(input)).toEqual({ offer: true, path: "/patient/pharmacy/collect/rx1?for=p1" });
    expect(refillHandoff({ ...input, low: false })).toEqual({ offer: false });
    expect(refillHandoff({ ...input, prescriptionId: null })).toEqual({ offer: false });
    expect(refillHandoff({ ...input, collectionOpen: false })).toEqual({ offer: false });
    expect(refillHandoff({ ...input, collectionOpen: null })).toEqual({ offer: false });
  });
});
