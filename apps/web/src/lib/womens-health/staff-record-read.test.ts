import { loadWomensHealthRecord, womensHealthRecordIsEmpty, type WomensHealthRpcClient } from "./staff-record-read";

const ok = {
  status: "ok",
  pregnancy: { is_pregnant: true, estimated_due_date: "2027-02-27", last_menstrual_period_date: null, high_risk: false, high_risk_notes: null },
  antenatal_visits: [{ id: "a1", visit_number: 1, gestational_week_at_visit: null, status: "scheduled", findings: null }],
  postnatal_profiles: [],
  breast_reports: [],
  fertility_requests: [],
};

function client(result: { data: unknown; error: { message?: string; code?: string } | null }): WomensHealthRpcClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return { calls, rpc: (fn, args) => (calls.push([fn, args]), Promise.resolve(result)) };
}

describe("loadWomensHealthRecord", () => {
  it("asks the audited function with the patient only", async () => {
    const c = client({ data: ok, error: null });
    const r = await loadWomensHealthRecord(c, "p1");
    expect(c.calls).toEqual([["read_womens_health_record_audited", { p_patient: "p1" }]]);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(womensHealthRecordIsEmpty(r.record)).toBe(false);
  });
  it("a refusal is 'denied', never an empty record", async () => {
    const r = await loadWomensHealthRecord(
      client({ data: { status: "denied", pregnancy: null, antenatal_visits: [], postnatal_profiles: [], breast_reports: [], fertility_requests: [] }, error: null }),
      "p1",
    );
    expect(r.kind).toBe("denied");
  });
  it("a database error and a malformed reply are errors", async () => {
    expect((await loadWomensHealthRecord(client({ data: null, error: { message: "boom" } }), "p1")).kind).toBe("error");
    expect((await loadWomensHealthRecord(client({ data: { status: "ok" }, error: null }), "p1")).kind).toBe("error");
    expect((await loadWomensHealthRecord(client({ data: null, error: null }), "p1")).kind).toBe("error");
  });
  it("an outright refusal by the database (42501) is 'denied', not a retryable outage", async () => {
    expect((await loadWomensHealthRecord(client({ data: null, error: { message: "not authorised", code: "42501" } }), "p1")).kind).toBe("denied");
  });
  it("an ok record with nothing in it is empty; a pregnancy flag or any row is not", () => {
    const empty = { pregnancy: null, antenatal_visits: [], postnatal_profiles: [], breast_reports: [], fertility_requests: [] };
    expect(womensHealthRecordIsEmpty(empty)).toBe(true);
    expect(womensHealthRecordIsEmpty({ ...empty, pregnancy: { is_pregnant: false, estimated_due_date: null, last_menstrual_period_date: null, high_risk: null, high_risk_notes: null } })).toBe(true);
    expect(womensHealthRecordIsEmpty({ ...empty, pregnancy: { is_pregnant: true, estimated_due_date: null, last_menstrual_period_date: null, high_risk: null, high_risk_notes: null } })).toBe(false);
    expect(womensHealthRecordIsEmpty({ ...empty, fertility_requests: [{ id: "f", created_at: "x", trying_duration_months: null, concern_notes: null, status: "requested" }] })).toBe(false);
  });
});
