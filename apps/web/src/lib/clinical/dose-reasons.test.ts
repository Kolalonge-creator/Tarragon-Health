import { describe, expect, it } from "@jest/globals";
import { parseDoseReasonsPayload, privateReasonByLog, privateReasonLabel, readDoseReasonsAudited } from "./dose-reasons";

const row = { medication_log_id: "l1", reason_code: "ran_out", status: "not_available", logged_at: "2026-10-22T08:00:00Z", scheduled_for_date: null, scheduled_time: "08:00" };

describe("parseDoseReasonsPayload (S54d, INV-10)", () => {
  it("returns rows and the has_more flag for a tied reader", () => {
    expect(parseDoseReasonsPayload({ status: "ok", rows: [row], has_more: true })).toEqual({ status: "ok", rows: [row], hasMore: true });
    expect(parseDoseReasonsPayload({ status: "ok", rows: [] })).toEqual({ status: "ok", rows: [], hasMore: false });
  });
  it("a refusal is denied and a malformed response is an error, never an empty list", () => {
    expect(parseDoseReasonsPayload({ status: "denied", rows: [] })).toEqual({ status: "denied" });
    for (const bad of [null, "x", {}, { status: "ok" }]) expect(parseDoseReasonsPayload(bad).status).toBe("error");
  });
});

describe("privateReasonByLog", () => {
  it("labels the reason against its dose entry and is empty when the read failed", () => {
    const m = privateReasonByLog({ status: "ok", rows: [row], hasMore: false });
    expect(m.get("l1")).toBe(privateReasonLabel("ran_out"));
    expect(privateReasonByLog({ status: "denied" }).size).toBe(0);
  });
});

describe("readDoseReasonsAudited", () => {
  it("calls the audited function (not the table) and surfaces an RPC error", async () => {
    const calls: string[] = [];
    const supa = { rpc: async (name: string) => { calls.push(name); return { data: null, error: { message: "boom" } }; } };
    const res = await readDoseReasonsAudited(supa as never, "p1");
    expect(calls).toEqual(["read_dose_reasons_audited"]);
    expect(res).toEqual({ status: "error", message: "boom" });
  });
});
