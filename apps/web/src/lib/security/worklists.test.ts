import { describe, expect, it } from "@jest/globals";
import { loadOrgOpenWorkCount, loadWorklist } from "./worklists";

const ok = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
const refused = { rpc: async () => ({ data: null, error: { message: "only an active clinician can read the worklist" } }) };

describe("worklist loaders", () => {
  it("groups items by queue in a fixed order, with an empty group for a quiet queue", async () => {
    const r = await loadWorklist(ok([{ kind: "lifestyle_flags", item_id: "1", kind_total: 1 }, { kind: "lab_results", item_id: "2", kind_total: "140" }]));
    expect(r.ok && r.groups.map((g) => g.kind)).toEqual(["lab_results", "abnormal_screening", "lifestyle_flags", "lifestyle_reviews", "annual_check_reviews", "therapy_approvals", "vaccination_verification"]);
    expect(r.ok && r.groups.find((g) => g.kind === "lab_results")?.items).toHaveLength(1);
    expect(r.ok && r.groups.find((g) => g.kind === "abnormal_screening")?.items).toHaveLength(0);
    expect(r.ok && r.groups.find((g) => g.kind === "lab_results")?.total).toBe(140);
  });
  it("reports a refusal as an error, never as an empty queue", async () => {
    expect(await loadWorklist(refused)).toEqual({ ok: false, message: "only an active clinician can read the worklist" });
  });
  it("reads one queue's total, as a number", async () => {
    expect(await loadOrgOpenWorkCount(ok([{ kind: "async_consults", n: "3" }]), "async_consults")).toEqual({ count: 3, error: null });
  });
  it("reports an error or a missing queue as an error, never as zero", async () => {
    expect((await loadOrgOpenWorkCount(refused, "async_consults")).error).not.toBeNull();
    expect((await loadOrgOpenWorkCount(ok([]), "async_consults")).count).toBeNull();
  });
});
