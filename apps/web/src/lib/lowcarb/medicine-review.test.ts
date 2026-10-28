/**
 * S50b: the medicine check reads through audited paths, runs the pure evaluator, and writes only unsigned drafts (INV-02). A draft table never
 * drives a real patient, an unknown pregnancy stops it, and an unreadable input is an error, never "nothing to suggest".
 */
import { getProposedConfig } from "@tarragon/shared";
import type { LowCarbConfig } from "@tarragon/clinical/lowcarb-programme";

const rpc = jest.fn();
const from = jest.fn();
const vitals = jest.fn();
const meds = jest.fn();
jest.mock("@/lib/clinical/vitals-audited", () => ({ readPatientVitalsAudited: (...a: unknown[]) => vitals(...a) }));
jest.mock("@/lib/clinical/medications-audited", () => ({ readPatientMedicationsAudited: (...a: unknown[]) => meds(...a) }));

import { runLowCarbMedicineReview } from "./medicine-review";

const config = getProposedConfig("lowcarb.protocol_rules").value as unknown as LowCarbConfig;
const NOW = new Date("2026-10-21T12:00:00Z");
const PATIENT = "0b8f6d0e-3c1a-4f3e-9a52-1d6f6a9f7c11";
const day = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const definition = {
  steps: [
    { id: "su_stop_on_low", match: { groups: ["sulfonylurea"] }, when: { any_glucose_below_mmol: 3.9 }, action: "stop", rationale: "Low reading on a sulfonylurea." },
    { id: "su_review", match: { groups: ["sulfonylurea"] }, when: { avg_glucose_below_mmol: 7 }, action: "review_dose", rationale: "Sugars are falling." },
  ],
};

/** A tiny chainable query builder: .select().eq().eq().maybeSingle() and .is() resolve to the table's canned answer. */
function table(answer: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is"]) q[m] = () => q;
  q.maybeSingle = async () => answer;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(answer).then(res);
  return q;
}

function setup(opts: { approved?: unknown; draft?: unknown; isTest?: boolean; sex?: string; pregnancy?: unknown; glucose?: number[]; alerts?: unknown[]; medicines?: unknown[] }) {
  rpc.mockReset();
  vitals.mockReset();
  meds.mockReset();
  from.mockReset();
  rpc.mockImplementation(async (name: string) => {
    if (name === "get_approved_protocol") return { data: opts.approved ?? null, error: null };
    if (name === "propose_care_plan_change") return { data: "11111111-1111-4111-8111-111111111111", error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  const answers: Record<string, unknown> = {
    protocols: { data: opts.draft ?? null, error: null },
    profiles: { data: { date_of_birth: "1975-01-01", sex: opts.sex ?? "male", is_test: opts.isTest ?? true }, error: null },
    patient_pregnancy: opts.pregnancy ?? { data: null, error: null },
    reproductive_health_profiles: { data: null, error: null },
    postnatal_profiles: { data: null, error: null },
    clinician_alerts: { data: opts.alerts ?? [], error: null },
  };
  from.mockImplementation((t: string) => table(answers[t]));
  vitals.mockResolvedValue({
    status: "ok",
    rows: (opts.glucose ?? [6.0, 6.2, 5.8, 6.4, 6.1, 3.5]).map((g, i) => ({ glucose_mmol_l: g, taken_at: day(i * 0.5 + 0.1) })),
  });
  meds.mockResolvedValue({
    status: "ok",
    rows: opts.medicines ?? [{ id: "m1", drug_name: "Gliclazide", dose: "80mg", frequency: "daily", source: "clinician", is_active: true, stopped_at: null, superseded_at: null }],
  });
  return { rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) } as never;
}
const run = (client: never, over: Partial<{ createDrafts: boolean; programmeActive: boolean }> = {}) =>
  runLowCarbMedicineReview(client, { patientId: PATIENT, config, programmeActive: over.programmeActive ?? true, lastMedicineReviewAt: day(1), createDrafts: over.createDrafts ?? false }, NOW);

const approvedRow = { id: "p1", code: "t2d_lowcarb_deprescribing", version: 2, definition };

describe("runLowCarbMedicineReview", () => {
  it("with no step table at all there is no suggestion, and it says so", async () => {
    await expect(run(setup({}))).resolves.toEqual({ kind: "no_protocol" });
  });

  it("a malformed approved table is refused as an error", async () => {
    const r = await run(setup({ approved: { id: "p1", code: "x", version: 1, definition: { steps: "nope" } } }));
    expect(r.kind).toBe("error");
  });

  it("an approved table gives suggestions, and without the draft switch writes nothing", async () => {
    const r = await run(setup({ approved: approvedRow }));
    expect(r.kind).toBe("result");
    if (r.kind !== "result" || r.result.kind !== "review") throw new Error("expected a review");
    expect(r.result.proposals.map((p) => p.stepId)).toEqual(["su_stop_on_low", "su_review"]);
    expect(r.created).toEqual([]);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["get_approved_protocol"]);
  });

  it("creating drafts proposes only the stop, with the engine as proposer, and never signs", async () => {
    const r = await run(setup({ approved: approvedRow }), { createDrafts: true });
    expect(r.kind).toBe("result");
    const calls = rpc.mock.calls.filter((c) => c[0] === "propose_care_plan_change");
    expect(calls).toHaveLength(1);
    const args = calls[0]?.[1] as Record<string, unknown>;
    expect(args.p_proposed_by).toBe("engine");
    expect(args.p_proposal).toEqual({ action: "stop", medication_id: "m1" });
    expect(args.p_protocol_id).toBe("p1");
    expect(rpc.mock.calls.map((c) => c[0]).every((n) => ["get_approved_protocol", "propose_care_plan_change"].includes(n as string))).toBe(true);
    if (r.kind === "result") expect(r.created).toEqual([{ changeId: "11111111-1111-4111-8111-111111111111", drugName: "Gliclazide" }]);
  });

  it("a draft step table drives a test patient but never a real one", async () => {
    const draft = { id: "p9", code: "t2d_lowcarb_deprescribing", version: 1, definition };
    const test = await run(setup({ draft, isTest: true }));
    expect(test.kind === "result" && test.result.kind).toBe("review");
    const real = await run(setup({ draft, isTest: false }), { createDrafts: true });
    expect(real.kind === "result" && real.result).toEqual({ kind: "no_proposal", reasons: ["protocol_not_approved_for_real_patient"] });
    expect(rpc.mock.calls.some((c) => c[0] === "propose_care_plan_change")).toBe(false);
  });

  it("an unreadable draft is no protocol, not a crash", async () => {
    await expect(run(setup({ draft: { id: "p9", code: "x", version: 1, definition: { steps: 5 } } }))).resolves.toEqual({ kind: "no_protocol" });
  });

  it("a female patient with no pregnancy record is unknown and stops the suggestion", async () => {
    const r = await run(setup({ approved: approvedRow, sex: "female" }));
    expect(r.kind === "result" && r.result).toEqual({ kind: "no_proposal", reasons: ["pregnancy_or_unknown"] });
  });

  it("a recorded pregnancy stops it", async () => {
    const r = await run(setup({ approved: approvedRow, sex: "female", pregnancy: { data: { is_pregnant: true }, error: null } }));
    expect(r.kind === "result" && r.result.kind).toBe("no_proposal");
  });

  it("an open emergency alert stops it", async () => {
    const r = await run(setup({ approved: approvedRow, alerts: [{ level: "emergency", override_level: null, status: "open" }] }));
    expect(r.kind === "result" && r.result).toEqual({ kind: "no_proposal", reasons: ["open_red_triage"] });
  });

  it("an open routine-only alert does not", async () => {
    const r = await run(setup({ approved: approvedRow, alerts: [{ level: "routine", override_level: null, status: "open" }] }));
    expect(r.kind === "result" && r.result.kind).toBe("review");
  });

  it("an unreadable reading list is an error, never 'nothing to suggest'", async () => {
    const client = setup({ approved: approvedRow });
    vitals.mockResolvedValue({ status: "denied" });
    expect((await run(client)).kind).toBe("error");
    vitals.mockResolvedValue({ status: "error", message: "x" });
    expect((await run(client)).kind).toBe("error");
  });

  it("unreadable medicines are an error", async () => {
    const client = setup({ approved: approvedRow });
    meds.mockResolvedValue({ status: "denied" });
    expect((await run(client)).kind).toBe("error");
  });

  it("a protocol read failure is an error", async () => {
    const client = setup({});
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect((await run(client)).kind).toBe("error");
  });

  it("an under-18 or no-date-of-birth patient is refused", async () => {
    const client = setup({ approved: approvedRow });
    from.mockImplementation((t: string) =>
      table(t === "profiles" ? { data: { date_of_birth: null, sex: "male", is_test: true }, error: null } : { data: t === "clinician_alerts" ? [] : null, error: null }),
    );
    expect((await run(client)).kind).toBe("error");
  });

  it("a failed draft save is reported and nothing is claimed as created", async () => {
    const client = setup({ approved: approvedRow });
    rpc.mockImplementation(async (name: string) =>
      name === "get_approved_protocol" ? { data: approvedRow, error: null } : { data: null, error: { message: "Not authorised to propose a change for this patient" } },
    );
    const r = await run(client, { createDrafts: true });
    expect(r.kind === "result" && r.created).toEqual([]);
    expect(r.kind === "result" && r.notes[0]).toMatch(/Not authorised/);
  });
});
