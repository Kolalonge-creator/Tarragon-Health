import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBpControlRate } from "./bp-control-rate-data";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 86_400_000;
const row = (daysAgo: number, systolic: number, diastolic: number) => ({ systolic, diastolic, taken_at: new Date(NOW - daysAgo * DAY).toISOString() });

function client(vitals: { data: unknown; error: unknown }, summary: { data: unknown; error: unknown }) {
  return {
    rpc: async (name: string) => (name === "read_patient_vitals_audited" ? vitals : summary),
  } as unknown as SupabaseClient;
}
const TARGET = { data: { target: { systolic: 135, diastolic: 85, source: "default" } }, error: null };

describe("loadBpControlRate", () => {
  it("gives the share in target past the gate, labelled by the target it used", async () => {
    const vitals = { data: { status: "ok", rows: [row(1, 120, 80), row(2, 130, 80), row(3, 150, 95), row(4, 126, 78)] }, error: null };
    const r = await loadBpControlRate(client(vitals, TARGET) as never, "p1", NOW);
    expect(r).toMatchObject({ status: "ok", target: { systolic: 135, diastolic: 85 } });
    if (r.status === "ok") expect(r.rate).toMatchObject({ gateMet: true, counted: 4, inTarget: 3, percentInTarget: 75 });
  });

  it("below the gate there is a count and no figure", async () => {
    const vitals = { data: { status: "ok", rows: [row(1, 120, 80)] }, error: null };
    const r = await loadBpControlRate(client(vitals, TARGET) as never, "p1", NOW);
    if (r.status === "ok") expect(r.rate).toMatchObject({ gateMet: false, percentInTarget: null, meanSystolic: null });
    else throw new Error("expected ok");
  });

  it("a refused read is denied, never an empty healthy-looking result", async () => {
    const r = await loadBpControlRate(client({ data: { status: "denied" }, error: null }, TARGET) as never, "p1", NOW);
    expect(r).toEqual({ status: "denied" });
  });

  it("a failed read of readings or of the target is an error, never 'no readings'", async () => {
    expect((await loadBpControlRate(client({ data: null, error: { message: "boom" } }, TARGET) as never, "p1", NOW)).status).toBe("error");
    const ok = { data: { status: "ok", rows: [row(1, 120, 80)] }, error: null };
    expect((await loadBpControlRate(client(ok, { data: null, error: { message: "boom" } }) as never, "p1", NOW)).status).toBe("error");
    expect((await loadBpControlRate(client(ok, { data: {}, error: null }) as never, "p1", NOW)).status).toBe("error");
  });
});
