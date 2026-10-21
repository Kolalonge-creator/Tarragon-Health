import { describe, expect, it } from "@jest/globals";
import { parseProposal } from "./proposal";

const PID = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries({ patient_id: PID, reason: "Chronic baseline near 150 over 95 for two years", days: "60", ...o })) f.set(k, v); return f; };

describe("parseProposal", () => {
  it("builds a blood pressure target and a low line", () => {
    const r = parseProposal(form({ domain: "bp", bp_target_systolic: "150", bp_target_diastolic: "95", bp_low_amber: "85" }));
    expect(r).toEqual({ ok: true, value: { patientId: PID, domain: "bp", params: { target: { systolic: 150, diastolic: 95 }, lowAmberSystolic: 85 }, reason: "Chronic baseline near 150 over 95 for two years", days: 60 } });
  });
  it("builds glucose settings and ignores blood pressure fields", () => {
    const r = parseProposal(form({ domain: "glucose", glucose_alert: "4.4", glucose_severe: "3.3", bp_low_amber: "85" }));
    expect(r).toMatchObject({ ok: true, value: { params: { hypoAlertMmol: 4.4, hypoSevereMmol: 3.3 } } });
  });
  it("refuses one half of a target, an empty setting, and anything outside the clamps", () => {
    expect(parseProposal(form({ domain: "bp", bp_target_systolic: "150" }))).toMatchObject({ ok: false, error: expect.stringMatching(/both numbers/) });
    expect(parseProposal(form({ domain: "bp", bp_target_diastolic: "90" }))).toMatchObject({ ok: false });
    expect(parseProposal(form({ domain: "bp" }))).toMatchObject({ ok: false, error: expect.stringMatching(/at least one setting/) });
    expect(parseProposal(form({ domain: "bp", bp_target_systolic: "175", bp_target_diastolic: "95" }))).toMatchObject({ ok: false, error: expect.stringMatching(/safety limits/) });
    expect(parseProposal(form({ domain: "glucose", glucose_severe: "2.5" }))).toMatchObject({ ok: false });
  });
  it("refuses a short reason, a bad period, a bad domain and a bad patient", () => {
    expect(parseProposal(form({ domain: "bp", bp_low_amber: "85", reason: "short" }))).toMatchObject({ ok: false, error: expect.stringMatching(/at least 10/) });
    expect(parseProposal(form({ domain: "bp", bp_low_amber: "85", days: "0" }))).toMatchObject({ ok: false });
    expect(parseProposal(form({ domain: "bp", bp_low_amber: "85", days: "400" }))).toMatchObject({ ok: false });
    expect(parseProposal(form({ domain: "nope" }))).toMatchObject({ ok: false });
    expect(parseProposal(form({ domain: "bp", bp_low_amber: "85", patient_id: "x" }))).toMatchObject({ ok: false });
  });
});
