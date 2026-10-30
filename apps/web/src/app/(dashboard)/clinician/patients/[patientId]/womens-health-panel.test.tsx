import { renderToStaticMarkup } from "react-dom/server";

/**
 * OQ-555 / OQ-558: the clinician Women's Health tab reads its five record kinds ONLY through the audited, tied database function, with no reason
 * typed, and a refusal or a failed read is shown as such, never as an empty list. The class of bug guarded here: a function refuses (or errors) and the
 * page quietly renders "nothing recorded" or a blank section, so a clinician acts on a pregnancy they were never shown.
 */

const rpc = jest.fn();
const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }));
// The cycle report is its own audited panel (S66) with its own tests; here it is a marker so the page can be rendered synchronously.
jest.mock("./cycle-pattern-report", () => ({ CyclePatternReportPanel: () => <div>CYCLE-REPORT-PANEL</div> }));
jest.mock("./fertility-request-status-form", () => ({ FertilityRequestStatusForm: () => <div>FERTILITY-STATUS-FORM</div> }));

import { WomensHealthPanel } from "./womens-health-panel";

const okReply = {
  status: "ok",
  pregnancy: { is_pregnant: true, estimated_due_date: "2027-02-27", last_menstrual_period_date: null, high_risk: true, high_risk_notes: "Previous pre-eclampsia" },
  antenatal_visits: [{ id: "a1", visit_number: 1, gestational_week_at_visit: 12, status: "scheduled", findings: "Booking visit done" }],
  postnatal_profiles: [{ id: "p1", delivery_date: "2026-05-01", delivery_mode: "vaginal", complications: null }],
  breast_reports: [{ id: "b1", created_at: "2026-09-01T10:00:00+00:00", symptom_types: ["lump"], laterality: "left" }],
  fertility_requests: [{ id: "f1", created_at: "2026-09-02T10:00:00+00:00", trying_duration_months: 14, concern_notes: "Irregular cycles", status: "requested" }],
};
const emptyArrays = { antenatal_visits: [], postnatal_profiles: [], breast_reports: [], fertility_requests: [] };

async function html(): Promise<string> {
  return renderToStaticMarkup(await WomensHealthPanel({ patientId: "patient-1" }));
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("WomensHealthPanel (OQ-555)", () => {
  it("reads through the audited function with the patient only (no reason), and never straight from a table", async () => {
    rpc.mockResolvedValue({ data: okReply, error: null });
    const out = await html();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("read_womens_health_record_audited", { p_patient: "patient-1" });
    expect(from).not.toHaveBeenCalled();
    expect(out).toContain("Previous pre-eclampsia");
    expect(out).toContain("Booking visit done");
    expect(out).toContain("Delivered 2026-05-01");
    expect(out).toContain("lump");
    expect(out).toContain("Irregular cycles");
    expect(out).toContain("CYCLE-REPORT-PANEL");
  });

  it("a refusal says so and shows no data and no 'nothing recorded' line", async () => {
    rpc.mockResolvedValue({ data: { status: "denied", pregnancy: null, ...emptyArrays }, error: null });
    const out = await html();
    expect(out).toContain("You cannot open this patient&#x27;s Women&#x27;s Health record");
    expect(out).toContain("the attempt has been recorded");
    expect(out).not.toMatch(/No other Women|nothing recorded|No Women/i);
    expect(out).not.toContain("Pregnancy");
  });

  it("a failed read is an alert that says it is not the same as nothing recorded", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const out = await html();
    expect(out).toContain('role="alert"');
    expect(out).toContain("could not be loaded");
    expect(out).toContain("not the same as there being nothing recorded");
    expect(out).not.toMatch(/No other Women/i);
  });

  it("a malformed reply is a failed read, not an empty record", async () => {
    rpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    const out = await html();
    expect(out).toContain("could not be loaded");
    expect(out).not.toMatch(/No other Women/i);
  });

  it("a successful but empty record says nothing is recorded (the only case that may)", async () => {
    rpc.mockResolvedValue({ data: { status: "ok", pregnancy: null, ...emptyArrays }, error: null });
    const out = await html();
    expect(out).toMatch(/No other Women&#x27;s Health data recorded yet/);
    expect(out).toContain("CYCLE-REPORT-PANEL");
  });
});
