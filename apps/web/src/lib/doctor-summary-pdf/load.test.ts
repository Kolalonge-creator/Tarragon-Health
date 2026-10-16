import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { SECTION_KEYS, summaryConfig, type SectionKey } from "./model";
import { sampleReadings, SAMPLE_NOW_MS } from "./sample-data";

jest.mock("@/lib/medicines/adherence-report-data", () => ({
  loadAdherenceReport: jest.fn(async () => ({ ok: true, data: { weeks: [], minDoses: 5, generatedAtMs: 0, hasScheduledMedicines: false } })),
}));
jest.mock("@/lib/emergency/dataset", () => ({
  loadEmergencyDatasetForPatient: jest.fn(async () => ({ allergies: [{ allergen: "Penicillin", reaction: null, severity: null }], conditions: ["hypertension"] })),
}));

import { loadAdherenceReport } from "@/lib/medicines/adherence-report-data";
import { loadDoctorSummary, recordSummaryGeneration } from "./load";

type Result = { data: unknown; error: { message: string } | null };

/** A recording fake of the query builder: every chained call returns the builder, awaiting it resolves the table's result. */
function fakeClient(results: Record<string, Result>, rpcResults: Record<string, Result> = {}) {
  const tables: string[] = [];
  const rpcs: string[] = [];
  const inserts: { table: string; row: unknown }[] = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    const self = () => b;
    for (const m of ["select", "eq", "is", "gte", "order", "limit", "in"]) b[m] = self;
    b.maybeSingle = async () => {
      const r = results[table] ?? { data: null, error: null };
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    };
    b.insert = async (row: unknown) => {
      inserts.push({ table, row });
      return results[`${table}:insert`] ?? { data: null, error: null };
    };
    b.then = (resolve: (v: Result) => unknown) => resolve(results[table] ?? { data: [], error: null });
    return b;
  };
  const client = {
    from: (table: string) => {
      tables.push(table);
      return builder(table);
    },
    rpc: async (name: string) => {
      rpcs.push(name);
      return rpcDefault(rpcResults, name);
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, tables, rpcs, inserts };
}
const rpcDefault = (r: Record<string, Result>, name: string): Result => r[name] ?? { data: [], error: null };

const profile: Result = { data: { full_name: "Ada Sample", date_of_birth: "1971-03-02", sex: "female", patient_number: "TH-1" }, error: null };
const bpRows: Result = {
  data: sampleReadings().map((r) => ({ taken_at: r.takenAt, systolic: r.systolic, diastolic: r.diastolic, pulse_bpm: r.pulse, source: r.source, validation_status: r.validationStatus })),
  error: null,
};

beforeEach(() => jest.clearAllMocks());

const ask = (sections: SectionKey[]) => ({ days: 30, sections });

describe("loadDoctorSummary reads only what was ticked", () => {
  it("touches no table other than the profile when nothing needs a read, and never a reproductive or mental health table", async () => {
    const f = fakeClient({ profiles: profile });
    await loadDoctorSummary(f.client, "p1", ask(["bp"]), SAMPLE_NOW_MS);
    // sabotage check: every table a ticked section may read is on this list, and nothing else
    const allowed = ["profiles", "vitals_readings", "medications", "medication_logs_latest_per_slot"];
    for (const t of f.tables) expect(allowed).toContain(t);
    expect(f.tables.join(",")).not.toMatch(/reproduct|menstrual|cycle|pregnan|contracept|mental|phq|gad|therapy|fertil/);
  });

  it("reads blood pressure once and leaves medicines, doses and symptoms alone when only the chart is ticked", async () => {
    const f = fakeClient({ profiles: profile, vitals_readings: bpRows });
    const r = await loadDoctorSummary(f.client, "p1", ask(["bp_chart"]), SAMPLE_NOW_MS);
    expect(f.tables).toEqual(["profiles", "vitals_readings"]);
    expect(f.rpcs).toEqual([]);
    expect(loadAdherenceReport).not.toHaveBeenCalled();
    expect(r.ok && r.data.medicines).toBeNull();
    expect(r.ok && r.data.symptoms).toBeNull();
    expect(r.ok && r.data.chart?.systolic.length).toBe(12);
  });

  it("keeps a wearable reading out of the average and the chart end to end", async () => {
    const f = fakeClient({ profiles: profile, vitals_readings: bpRows });
    const r = await loadDoctorSummary(f.client, "p1", ask(["bp", "bp_chart"]), SAMPLE_NOW_MS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.bp?.average?.count).toBe(12);
    expect(r.data.bp?.lines.some((l) => l.trust === "wearable")).toBe(true);
    expect(r.data.chart?.systolic).toHaveLength(12);
    expect((r.data.bp?.average?.systolic ?? 999) < 150).toBe(true);
  });

  it("filters a reproductive symptom entry out of the journal", async () => {
    const f = fakeClient(
      { profiles: profile },
      { patient_symptom_journal: { data: [
        { reported_at: "2026-10-14T18:00:00Z", symptom_type: "dizziness", free_text: null, severity: 2 },
        { reported_at: "2026-10-13T18:00:00Z", symptom_type: "testicular_pain", free_text: "keep private", severity: 4 },
      ], error: null } },
    );
    const r = await loadDoctorSummary(f.client, "p1", ask(["symptoms"]), SAMPLE_NOW_MS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.symptoms?.lines.map((l) => l.label)).toEqual(["Dizziness"]);
    expect(JSON.stringify(r.data)).not.toMatch(/keep private/);
  });

  it("asks the shared adherence function for whole weeks covering the period", async () => {
    const f = fakeClient({ profiles: profile });
    await loadDoctorSummary(f.client, "p1", { days: 60, sections: ["adherence"] }, SAMPLE_NOW_MS);
    expect(loadAdherenceReport).toHaveBeenCalledWith(f.client, "p1", SAMPLE_NOW_MS, 9);
  });

  it("names the medicine for a skipped dose and prints a clear fallback when the medicine row is gone", async () => {
    const f = fakeClient({
      profiles: profile,
      medication_logs_latest_per_slot: { data: [
        { medication_id: "m1", scheduled_for_date: "2026-10-12", scheduled_time: "20:00:00", missed_reason: "forgot", reason: null },
        { medication_id: "m2", scheduled_for_date: "2026-10-11", scheduled_time: "08:00:00", missed_reason: null, reason: null },
      ], error: null },
      medications: { data: [{ id: "m1", drug_name: "Metformin" }], error: null },
    });
    const r = await loadDoctorSummary(f.client, "p1", ask(["skipped"]), SAMPLE_NOW_MS);
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.skipped?.lines.map((l) => l.medicine)).toEqual(["Metformin", "A medicine"]);
    expect(r.data.skipped?.lines[0]?.when).toBe("12 Oct, 20:00");
  });
});

describe("loadDoctorSummary fails loudly, never with a quietly missing section", () => {
  const cases: [string, SectionKey, Record<string, Result>, Record<string, Result>][] = [
    ["blood pressure", "bp", { profiles: profile, vitals_readings: { data: null, error: { message: "x" } } }, {}],
    ["medicines", "medicines", { profiles: profile, medications: { data: null, error: { message: "x" } } }, {}],
    ["skipped doses", "skipped", { profiles: profile, medication_logs_latest_per_slot: { data: null, error: { message: "x" } } }, {}],
    ["symptoms", "symptoms", { profiles: profile }, { patient_symptom_journal: { data: null, error: { message: "x" } } }],
  ];
  it.each(cases)("%s", async (_name, section, tables, rpcs) => {
    const f = fakeClient(tables, rpcs);
    const r = await loadDoctorSummary(f.client, "p1", ask([section]), SAMPLE_NOW_MS);
    expect(r.ok).toBe(false);
  });

  it("fails when the adherence read fails", async () => {
    (loadAdherenceReport as jest.Mock).mockResolvedValueOnce({ ok: false, error: "x" });
    const f = fakeClient({ profiles: profile });
    expect((await loadDoctorSummary(f.client, "p1", ask(["adherence"]), SAMPLE_NOW_MS)).ok).toBe(false);
  });

  it("fails when the profile cannot be read", async () => {
    const f = fakeClient({ profiles: { data: null, error: { message: "x" } } });
    expect((await loadDoctorSummary(f.client, "p1", ask(["bp"]), SAMPLE_NOW_MS)).ok).toBe(false);
  });
});

describe("audit row", () => {
  it("records the sections and period, never a value from the record, as the patient on her own record", async () => {
    const f = fakeClient({});
    const r = await recordSummaryGeneration(f.client, { id: "p1", organisationId: "o1" }, { days: 30, sections: ["bp", "symptoms"] });
    expect(r).toEqual({ ok: true });
    expect(f.inserts).toHaveLength(1);
    expect(f.inserts[0]).toEqual({
      table: "audit_log",
      row: {
        organisation_id: "o1",
        actor_id: "p1",
        action: "patient.doctor_summary_generated",
        entity_type: "profiles",
        entity_id: "p1",
        subject_patient_id: "p1",
        event: { sections: ["bp", "symptoms"], period_days: 30, config_key: "record.doctor_summary_pdf" },
      },
    });
  });
  it("reports failure when the row cannot be written", async () => {
    const f = fakeClient({ "audit_log:insert": { data: null, error: { message: "denied" } } });
    expect(await recordSummaryGeneration(f.client, { id: "p1", organisationId: "o1" }, { days: 30, sections: ["bp"] })).toEqual({ ok: false });
  });
});

describe("sections", () => {
  it("every section key is handled by the loader", async () => {
    for (const s of SECTION_KEYS) {
      const f = fakeClient({ profiles: profile, vitals_readings: bpRows });
      const r = await loadDoctorSummary(f.client, "p1", ask([s]), SAMPLE_NOW_MS, summaryConfig());
      expect(r.ok).toBe(true);
    }
  });
});
