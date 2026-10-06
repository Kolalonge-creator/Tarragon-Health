/**
 * S24 server loader for "Suggest next step". The evaluator itself is covered in packages/clinical; this proves the loader:
 * reads only through audited, tie-gated functions (never a direct table the clinician must not read), refuses on a denied
 * or unreadable input instead of treating it as "no data", runs only an approved protocol, and writes nothing but the
 * draft through `propose_care_plan_change` (safety case 10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Rpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = jest.fn<ReturnType<Rpc>, Parameters<Rpc>>();
const tables: string[] = [];
let tableData: Record<string, { data: unknown; error: { message: string } | null }> = {};

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => ({
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    from: (table: string) => {
      tables.push(table);
      const result = () => Promise.resolve(tableData[table] ?? { data: null, error: null });
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => result(),
        maybeSingle: () => result(),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
      };
      return chain;
    },
  })),
}));

import { suggestTitration } from "./suggest-titration";

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "..", "..", "packages", "clinical", "fixtures", "titration-placeholder.json"), "utf8"),
) as Record<string, unknown>;
const ago = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();
const PATIENT = "patient-1";

let overrides: Record<string, unknown> = {};
const adherence = (percent: number | null) => ({
  status: "ok", percent, due: 20, taken: 18, late: 0, skipped: 1, missed: 1, unavailable: 0, threshold_percent: 80,
  window_start: ago(7), window_end: ago(0), below_threshold: false,
});

function setup(opts: { sex?: string; pregnancyRow?: boolean | null; readings?: number; planTarget?: unknown; alerts?: unknown[] } = {}): void {
  overrides = {};
  tableData = {
    profiles: { data: { date_of_birth: "1974-05-01", sex: opts.sex ?? "male", is_test: false }, error: null },
    patient_pregnancy: { data: opts.pregnancyRow === undefined || opts.pregnancyRow === null ? null : { is_pregnant: opts.pregnancyRow }, error: null },
    care_plans: {
      data: [{ status: "active", target_ranges: opts.planTarget ?? { blood_pressure: { systolic_max: 135, diastolic_max: 85 } } }],
      error: null,
    },
    clinician_alerts: { data: opts.alerts ?? [], error: null },
  };
  const n = opts.readings ?? 5;
  const respond: Record<string, unknown> = {
    get_approved_protocol: { id: "proto-1", code: "htn_hearts_ng", version: 1, definition: fixture },
    read_patient_vitals_audited: {
      status: "ok",
      rows: Array.from({ length: n }, (_, i) => ({ systolic: 150, diastolic: 95, taken_at: ago(1 + i * 0.5), validation_status: "valid", vital_type: "blood_pressure" })),
    },
    read_patient_medications_audited: {
      status: "ok",
      rows: [{ id: "med-a", drug_name: "TestDrugA", dose: "5 mg", frequency: "once daily", source: "clinician", is_active: true, created_at: ago(60), stopped_at: null, stopped_reason: null, superseded_at: null }],
    },
    medication_weekly_adherence: adherence(90),
    read_medication_dose_log_audited: { status: "ok", rows: [] },
    propose_care_plan_change: "change-1",
  };
  rpc.mockReset();
  rpc.mockImplementation(async (name) => {
    if (name in overrides) return overrides[name] as { data: unknown; error: { message: string } | null };
    return { data: respond[name], error: null };
  });
  tables.length = 0;
}
const proposeCalls = () => rpc.mock.calls.filter(([n]) => n === "propose_care_plan_change");

describe("suggestTitration", () => {
  it("proposes the next step as a draft and stores it through propose_care_plan_change only", async () => {
    setup();
    const r = await suggestTitration(PATIENT);
    expect(r.kind).toBe("proposed");
    if (r.kind !== "proposed") return;
    expect(r.changeId).toBe("change-1");
    expect(r.result.stepId).toBe("step_1_raise_a");
    const [, args] = proposeCalls()[0] as [string, Record<string, unknown>];
    expect(args).toMatchObject({ p_patient: PATIENT, p_kind: "medication", p_proposed_by: "engine", p_protocol_id: "proto-1" });
    expect(args.p_proposal).toMatchObject({ action: "change", medication_id: "med-a" });
    expect((args.p_engine_inputs as { protocol: { status: string } }).protocol.status).toBe("approved");
    expect(proposeCalls()).toHaveLength(1);
  });

  it("reads clinical data only through audited functions, never the tables staff must not read directly", async () => {
    setup();
    await suggestTitration(PATIENT);
    const names = rpc.mock.calls.map(([n]) => n);
    expect(names).toEqual(expect.arrayContaining(["read_patient_vitals_audited", "read_patient_medications_audited", "medication_weekly_adherence", "read_medication_dose_log_audited"]));
    for (const forbidden of ["vitals_readings", "medications", "dose_events", "medication_logs", "triage_events", "prescriptions"]) {
      expect(tables).not.toContain(forbidden);
    }
  });

  it("returns no_protocol when none is approved, and writes nothing", async () => {
    setup();
    overrides.get_approved_protocol = { data: null, error: null };
    expect(await suggestTitration(PATIENT)).toEqual({ kind: "no_protocol" });
    expect(proposeCalls()).toHaveLength(0);
  });

  it("refuses a malformed approved protocol whole", async () => {
    setup();
    overrides.get_approved_protocol = { data: { id: "p", code: "htn_hearts_ng", version: 1, definition: { steps: [] } }, error: null };
    const r = await suggestTitration(PATIENT);
    expect(r.kind).toBe("error");
    expect(proposeCalls()).toHaveLength(0);
  });

  it("an unreadable protocol response is an error", async () => {
    setup();
    overrides.get_approved_protocol = { data: { nonsense: true }, error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
    overrides.get_approved_protocol = { data: null, error: { message: "boom" } };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
  });

  it("shows why there is no suggestion, with every reason, and writes nothing", async () => {
    setup({ readings: 2 });
    overrides.medication_weekly_adherence = { data: adherence(40), error: null };
    const r = await suggestTitration(PATIENT);
    expect(r.kind).toBe("no_proposal");
    if (r.kind === "no_proposal") expect(r.reasons.map((x) => x.code)).toEqual(["too_few_readings", "low_adherence"]);
    expect(proposeCalls()).toHaveLength(0);
  });

  it("unknown adherence stops the proposal", async () => {
    setup();
    overrides.medication_weekly_adherence = { data: adherence(null), error: null };
    const r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["adherence_unknown"]);
  });

  it("an unreadable adherence figure is unknown, not a pass", async () => {
    setup();
    overrides.medication_weekly_adherence = { data: null, error: { message: "x" } };
    const r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["adherence_unknown"]);
  });

  it("a female patient with no pregnancy record is unknown and stops the proposal; a recorded negative does not", async () => {
    setup({ sex: "female", pregnancyRow: null });
    const r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["pregnancy_or_unknown"]);
    setup({ sex: "female", pregnancyRow: false });
    expect((await suggestTitration(PATIENT)).kind).toBe("proposed");
    setup({ sex: "female", pregnancyRow: true });
    const yes = await suggestTitration(PATIENT);
    expect(yes.kind === "no_proposal" && yes.reasons[0]?.code).toBe("pregnancy_or_unknown");
  });

  it("an open emergency alert is red triage; an open review alert is amber; a routine or closed one is not", async () => {
    setup({ alerts: [{ level: "emergency", override_level: null, status: "open" }] });
    let r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["open_red_triage"]);
    setup({ alerts: [{ level: "routine", override_level: "clinician_review", status: "acknowledged" }] });
    r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["open_amber_triage"]);
    setup({ alerts: [{ level: "emergency", override_level: null, status: "resolved" }, { level: "routine", override_level: null, status: "open" }] });
    expect((await suggestTitration(PATIENT)).kind).toBe("proposed");
  });

  it("a skipped dose or stopped medicine with a side effect reason, or an unreadable dose log, counts as side effects reported", async () => {
    setup();
    overrides.read_medication_dose_log_audited = { data: { status: "ok", rows: [{ id: "d", status: "skipped", reason: "bad cough", logged_at: ago(3), scheduled_for_date: null, scheduled_time: null, logged_by_profile_id: null, medication: null }] }, error: null };
    let r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["side_effects_reported"]);
    setup();
    overrides.read_medication_dose_log_audited = { data: { status: "denied" }, error: null };
    r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["side_effects_reported"]);
    setup();
    overrides.read_patient_medications_audited = {
      data: { status: "ok", rows: [
        { id: "med-a", drug_name: "TestDrugA", dose: "5 mg", frequency: "once daily", source: "clinician", is_active: true, created_at: ago(60), stopped_at: null, stopped_reason: null },
        { id: "med-x", drug_name: "TestDrugX", dose: "1 mg", frequency: "daily", source: "clinician", is_active: false, created_at: ago(80), stopped_at: ago(40), stopped_reason: "Side effects" },
      ] },
      error: null,
    };
    r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toContain("side_effects_reported");
  });

  it("a recent medicine start is a change inside the review window", async () => {
    setup();
    overrides.read_patient_medications_audited = {
      data: { status: "ok", rows: [{ id: "med-a", drug_name: "TestDrugA", dose: "5 mg", frequency: "once daily", source: "clinician", is_active: true, created_at: ago(2), stopped_at: null, stopped_reason: null }] },
      error: null,
    };
    const r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["change_inside_review_window"]);
  });

  it("a denied or failed audited read is an error, never 'no data'", async () => {
    for (const name of ["read_patient_vitals_audited", "read_patient_medications_audited"]) {
      setup();
      overrides[name] = { data: { status: "denied", rows: [] }, error: null };
      expect((await suggestTitration(PATIENT)).kind).toBe("error");
      setup();
      overrides[name] = { data: null, error: { message: "nope" } };
      expect((await suggestTitration(PATIENT)).kind).toBe("error");
      expect(proposeCalls()).toHaveLength(0);
    }
  });

  it("errors when the patient, care plan or alerts cannot be read, or there is no target", async () => {
    setup();
    tableData.profiles = { data: null, error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
    setup();
    tableData.profiles = { data: { bogus: 1 }, error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
    setup();
    tableData.care_plans = { data: null, error: { message: "x" } };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
    setup();
    tableData.clinician_alerts = { data: null, error: { message: "x" } };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
    setup({ planTarget: {} });
    const none = await suggestTitration(PATIENT);
    expect(none.kind === "error" && none.message).toMatch(/target/i);
    setup();
    tableData.clinician_alerts = { data: [{ level: 5 }], error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
  });

  it("a malformed reading or medicine row is an error", async () => {
    setup();
    overrides.read_patient_vitals_audited = { data: { status: "ok", rows: [{ systolic: "x" }] }, error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
    setup();
    overrides.read_patient_medications_audited = { data: { status: "ok", rows: [{ id: 1 }] }, error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
  });

  it("surfaces a save failure and never reports a draft that was not stored", async () => {
    setup();
    overrides.propose_care_plan_change = { data: null, error: { message: "Not authorised to propose a change for this patient" } };
    const r = await suggestTitration(PATIENT);
    expect(r).toEqual({ kind: "error", message: "Not authorised to propose a change for this patient" });
    setup();
    overrides.propose_care_plan_change = { data: { id: 1 }, error: null };
    expect((await suggestTitration(PATIENT)).kind).toBe("error");
  });

  it("returns an error rather than throwing when something unexpected breaks", async () => {
    setup();
    rpc.mockImplementation(async () => {
      throw new Error("network down");
    });
    expect(await suggestTitration(PATIENT)).toEqual({ kind: "error", message: "network down" });
  });

  it("readings without a diastolic value are skipped, and an unvalidated reading blocks (unreliable)", async () => {
    setup();
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => ({ systolic: 150, diastolic: 95, taken_at: ago(1 + i * 0.5), validation_status: "valid" })),
      { systolic: 150, diastolic: null, taken_at: ago(1), validation_status: "valid" },
      { systolic: 150, diastolic: 95, taken_at: ago(1), validation_status: "requires_validation" },
    ];
    overrides.read_patient_vitals_audited = { data: { status: "ok", rows }, error: null };
    const r = await suggestTitration(PATIENT);
    expect(r.kind === "no_proposal" && r.reasons.map((x) => x.code)).toEqual(["unreliable_readings"]);
  });
});
