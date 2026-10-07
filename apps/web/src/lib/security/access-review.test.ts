import { describe, expect, it } from "@jest/globals";
import { dueForReview, loadAccessReview, loadRecentOpens } from "./access-review";

const ok = (data: unknown) => ({ rpc: async () => ({ data, error: null }), from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data, error: null }) }) }) }) });
const refused = { rpc: async () => ({ data: null, error: { message: "not allowed" } }), from: () => ({ select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "denied" } }) }) }) }) };

describe("access review loaders", () => {
  it("returns the rows when the call works", async () => {
    expect(await loadAccessReview(ok([{ staff_id: "a" }]))).toEqual({ ok: true, rows: [{ staff_id: "a" }] });
    expect(await loadRecentOpens(ok([{ id: "1" }]))).toEqual({ ok: true, rows: [{ id: "1" }] });
  });
  it("reports a refusal as an error, never as an empty list", async () => {
    expect(await loadAccessReview(refused)).toEqual({ ok: false, message: "not allowed" });
    expect(await loadRecentOpens(refused)).toEqual({ ok: false, message: "denied" });
  });
  it("lists only classes with old rows, biggest first", () => {
    const rows = [
      { table_name: "a", retention_class: "financial", period: "6 years", rows_older_than_period: 0, reviewed: false },
      { table_name: "b", retention_class: "clinical_record", period: "8 years", rows_older_than_period: 3, reviewed: false },
      { table_name: "c", retention_class: "operational", period: "730 days", rows_older_than_period: 9, reviewed: false },
    ];
    expect(dueForReview(rows).map((r) => r.table_name)).toEqual(["c", "b"]);
  });
});
