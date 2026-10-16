import { jest } from "@jest/globals";

/**
 * S47 review fix: the yearly build route. A failing patient is recorded (so the database puts them behind everyone and eventually drops them) and does not
 * stop the others; a draft that is merely waiting is not a failure; the guard being off stops the loop and requests no AI draft.
 */
const rpc = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const drafter = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), from: () => chain() }) }));
jest.mock("@/lib/health-report/ai-summary", () => ({ createAiSummaryDrafter: () => drafter }));
const build = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock("@/lib/health-report/build", () => ({ buildHealthReportDraft: (...a: unknown[]) => build(...a) }));
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: null, error: null });
  return c;
}

import { GET } from "./route";

const req = () => new Request("http://x/api/cron/health-report-build?year=2026", { headers: { authorization: "Bearer s3cret" } });
beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  rpc.mockReset().mockImplementation(async (fn: unknown) => (fn === "health_report_candidates" ? { data: [{ patient_id: "bad" }, { patient_id: "good1" }, { patient_id: "wait" }, { patient_id: "good2" }], error: null } : { data: 1, error: null }));
  build.mockReset();
});

describe("health-report-build route", () => {
  it("records a failing patient and carries on to the others", async () => {
    build.mockImplementation(async (_s: unknown, p: unknown) => { const id = (p as { patientId: string }).patientId; return id === "bad" ? { status: "refused", reason: "error", detail: "collector exploded" } : id === "wait" ? { status: "refused", reason: "draft_waiting" } : { status: "created", reportId: "r" }; });
    const res = await GET(req());
    const body = (await res.json()) as { created: number; failed: number; considered: number };
    expect(body).toMatchObject({ considered: 4, created: 2, failed: 1 });
    expect(rpc).toHaveBeenCalledWith("record_health_report_build_failure", { p_patient: "bad", p_year: 2026, p_reason: "error: collector exploded" });
    // a draft that is just waiting for a signature is not a failure
    expect(rpc).not.toHaveBeenCalledWith("record_health_report_build_failure", expect.objectContaining({ p_patient: "wait" }));
    expect(build).toHaveBeenCalledTimes(4);
  });

  it("stops at the first guard refusal and records nothing (the guard is global, not the patient's fault)", async () => {
    build.mockResolvedValue({ status: "refused", reason: "guard_off" });
    const body = (await (await GET(req())).json()) as { failed: number };
    expect(build).toHaveBeenCalledTimes(1);
    expect(body.failed).toBe(0);
    expect(rpc).not.toHaveBeenCalledWith("record_health_report_build_failure", expect.anything());
  });

  it("refuses without the cron secret", async () => {
    expect((await GET(new Request("http://x/api/cron/health-report-build"))).status).toBe(401);
  });
});
