import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHomeBpConfig } from "@tarragon/clinical";
import { getProposedConfig } from "@tarragon/shared";
import { buildBpVisitSummary, parseVisitAdherence, type VisitBpRow } from "./bp-visit-summary";

const CFG = parseHomeBpConfig(1, getProposedConfig("bp.home_programme").value);
const NOW = Date.parse("2026-10-20T10:00:00Z");
const adh = { due: 14, taken: 8, late: 2, percent: 71 };

/** Twelve readings over three Lagos days (4 a day, two sessions, two readings a minute apart). */
function enough(sys = 130, dia = 82): VisitBpRow[] {
  const days = ["2026-10-16", "2026-10-17", "2026-10-18"];
  return days.flatMap((d) =>
    ["06:00:00", "06:02:00", "18:00:00", "18:02:00"].map((t) => ({ systolic: sys, diastolic: dia, taken_at: `${d}T${t}+01:00`, source: "manual" })),
  );
}

describe("bring this to your visit summary (S07y)", () => {
  it("shows the 7-day average only when the programme gate is met, with the same rounding as the phone card", () => {
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: enough(), programme: CFG, adherence: adh, symptoms: [] });
    expect(s.bpLines).toEqual(["Average of 12 readings over 3 days: 130 over 82 mmHg."]);
  });

  it("shows no average at all, and says so, when no home programme is signed (never one from unsigned values)", () => {
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: enough(), programme: null, adherence: adh, symptoms: [] });
    expect(s.bpLines).toEqual(["A 7-day average is not shown yet."]);
  });

  it("says plainly that there are not enough readings yet, and what is missing, instead of an average", () => {
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: enough().slice(0, 5), programme: CFG, adherence: adh, symptoms: [] });
    expect(s.bpLines[0]).toMatch(/^Not enough readings yet/);
    expect(s.bpLines[0]).toContain("at least 12 readings over at least 3 days");
    expect(s.bpLines.join(" ")).not.toMatch(/Average of/);
  });

  it("says there are no readings when there are none, and ignores readings older than 7 days and wearable estimates", () => {
    const old = enough().map((r) => ({ ...r, taken_at: r.taken_at.replace("2026-10", "2026-09") }));
    expect(buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: old, programme: CFG, adherence: adh, symptoms: [] }).bpLines).toEqual(["No home readings in the last 7 days."]);
    const est = enough().map((r) => ({ ...r, source: "wearable" }));
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: est, programme: CFG, adherence: adh, symptoms: [] });
    expect(s.bpLines.join(" ")).not.toMatch(/Average of/);
  });

  it("never grades: no band word, target, colour or the word controlled", () => {
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: enough(190, 125), programme: CFG, adherence: adh, symptoms: [{ code: "chest_pain", reported_at: "2026-10-19T09:00:00Z" }] });
    expect(JSON.stringify(s)).not.toMatch(/controlled|above|borderline|within|target|urgent|emergency|high/i);
  });

  it("counts late doses as marked taken (as S08x does) and shows the server's percentage", () => {
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: [], programme: CFG, adherence: adh, symptoms: [] });
    expect(s.medLine).toBe("Doses you marked taken in the last 7 days: 10 of 14, 71 percent. This is what you recorded in the app. It is not a clinical measure.");
  });

  it("shows no percentage when the server gave none, and a separate line when nothing was due", () => {
    expect(buildBpVisitSummary({ patientName: "A", nowMs: NOW, readings: [], programme: CFG, adherence: { due: 2, taken: 2, late: 0, percent: null }, symptoms: [] }).medLine).toContain("fewer than 3 doses");
    expect(buildBpVisitSummary({ patientName: "A", nowMs: NOW, readings: [], programme: CFG, adherence: { due: 0, taken: 0, late: 0, percent: null }, symptoms: [] }).medLine).toContain("No scheduled medicine doses");
  });

  it("lists ticked symptoms once per day, newest first, only inside the 7 days", () => {
    const s = buildBpVisitSummary({
      patientName: "Ada",
      nowMs: NOW,
      readings: [],
      programme: CFG,
      adherence: adh,
      symptoms: [
        { code: "dizziness", reported_at: "2026-10-18T08:00:00Z" },
        { code: "dizziness", reported_at: "2026-10-18T20:00:00Z" },
        { code: "severe_headache", reported_at: "2026-10-19T08:00:00Z" },
        { code: "dizziness", reported_at: "2026-10-01T08:00:00Z" },
      ],
    });
    expect(s.symLines).toEqual(["19 Oct 2026: Severe headache", "18 Oct 2026: Dizziness"]);
    expect(buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: [], programme: CFG, adherence: adh, symptoms: [] }).symLines).toEqual(["You did not tick any symptoms in the last 7 days."]);
  });

  it("parses the adherence function's answer strictly: anything but status ok is refused", () => {
    expect(parseVisitAdherence({ status: "ok", due: 7, taken: 4, late: 1, percent: 71 })).toEqual({ due: 7, taken: 4, late: 1, percent: 71 });
    expect(parseVisitAdherence({ status: "ok", due: 2, taken: 1, late: 0, percent: null })?.percent).toBeNull();
    expect(parseVisitAdherence({ status: "denied" })).toBeNull();
    expect(parseVisitAdherence({ status: "ok", due: "7", taken: 4, late: 1, percent: 71 })).toBeNull();
    expect(parseVisitAdherence(null)).toBeNull();
  });

  it("carries no clinician-only or laboratory content and no em dash", () => {
    const s = buildBpVisitSummary({ patientName: "Ada", nowMs: NOW, readings: enough(), programme: CFG, adherence: adh, symptoms: [] });
    expect(JSON.stringify(s)).not.toMatch(/masked|white.?coat|pattern for review|clinic reading|—/i);
    expect(s.footer).toContain("no laboratory results");
  });

  it("the data module reads only the caller's own readings, symptoms and adherence, and writes one access-log row", () => {
    const src = readFileSync(join(__dirname, "bp-visit-summary-response.ts"), "utf8");
    expect([...src.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort()).toEqual(["symptom_reports", "vitals_readings"]);
    expect([...src.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort()).toEqual(["log_patient_data_export", "medication_weekly_adherence"]);
    expect(src).toContain("status: 503");
    // the same sources the server's programme average counts, and only symptoms the patient entered herself
    expect(src).toContain('.in("source", ["manual", "device"])');
    expect(src).toContain('.eq("recorded_by", patientId)');
    expect(src).not.toContain("getProposedConfig");
  });
});
