import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

const mockLoad = jest.fn();
jest.mock("./adherence-report-data", () => ({ loadAdherenceReport: (...a: unknown[]) => mockLoad(...a) }));

import { COUNTER_WEEKS, createCounterSnapshot, weeksForCounter } from "./counter-snapshot";

const week = (i: number) => ({ weekStart: `2026-10-0${i}`, weekEnd: `2026-10-1${i}`, due: 14, markedTaken: 10, late: 1, skipped: 2, noRecord: 2, couldNotGet: 0, percent: 71 });
const report = (weeks: ReturnType<typeof week>[], has = true) => ({ ok: true, data: { weeks, minDoses: 7, generatedAtMs: 0, hasScheduledMedicines: has } });

function client(result: { data: unknown; error: { code?: string } | null }) {
  const rpc = jest.fn(async () => result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("weeksForCounter", () => {
  it("keeps the most recent weeks, with exactly the keys the database accepts and nothing else", () => {
    const out = weeksForCounter(Array.from({ length: 8 }, (_, i) => week(i + 1)));
    expect(out).toHaveLength(COUNTER_WEEKS);
    expect(Object.keys(out[0]).sort()).toEqual(["could_not_get", "due", "late", "marked_taken", "no_record", "percent", "skipped", "week_end", "week_start"]);
    expect(out[0]).toMatchObject({ marked_taken: 10, skipped: 2, no_record: 2 });
  });
});

describe("createCounterSnapshot", () => {
  beforeEach(() => mockLoad.mockReset());

  it("uses the same report function as the patient's own page, and returns the link token and PIN once", async () => {
    mockLoad.mockResolvedValue(report([week(1), week(2)]));
    const { client: c, rpc } = client({ data: { token: "t".repeat(64), pin: "123456", expires_at: "2026-10-20T20:00:00Z" }, error: null });
    const r = await createCounterSnapshot(c as never, "p1", 2, 1000);
    expect(mockLoad).toHaveBeenCalledWith(expect.anything(), "p1", 1000);
    expect(rpc).toHaveBeenCalledWith("create_pharmacy_counter_snapshot", { p_weeks: expect.any(Array), p_min_doses: 7, p_expires_in_hours: 2 });
    expect(r).toEqual({ ok: true, token: "t".repeat(64), pin: "123456", expiresAt: "2026-10-20T20:00:00Z" });
  });

  it("hands out nothing for a failed report or when no scheduled medicine is due, and never calls the database", async () => {
    const { client: c, rpc } = client({ data: null, error: null });
    mockLoad.mockResolvedValue({ ok: false, error: "x" });
    expect(await createCounterSnapshot(c as never, "p1", 2)).toEqual({ ok: false, reason: "report_failed" });
    mockLoad.mockResolvedValue(report([{ ...week(1), due: 0, markedTaken: 0, late: 0, skipped: 0, noRecord: 0, couldNotGet: 0, percent: null }], false));
    expect(await createCounterSnapshot(c as never, "p1", 2)).toEqual({ ok: false, reason: "no_doses" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hands out nothing when the weeks that would be sent have no doses due, even if an older week had", async () => {
    const old = { ...week(5), due: 14 };
    const empty = (i: number) => ({ ...week(i), due: 0, markedTaken: 0, late: 0, skipped: 0, noRecord: 0, couldNotGet: 0, percent: null });
    mockLoad.mockResolvedValue(report([empty(1), empty(2), empty(3), empty(4), old]));
    const { client: c, rpc } = client({ data: null, error: null });
    expect(await createCounterSnapshot(c as never, "p1", 2)).toEqual({ ok: false, reason: "no_doses" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps the database's refusals to plain reasons, and a malformed answer is a failure", async () => {
    mockLoad.mockResolvedValue(report([week(1)]));
    expect(await createCounterSnapshot(client({ data: null, error: { code: "55000" } }).client as never, "p1", 2)).toEqual({ ok: false, reason: "closed" });
    expect(await createCounterSnapshot(client({ data: null, error: { code: "53400" } }).client as never, "p1", 2)).toEqual({ ok: false, reason: "too_many" });
    expect(await createCounterSnapshot(client({ data: null, error: { code: "XX000" } }).client as never, "p1", 2)).toEqual({ ok: false, reason: "failed" });
    expect(await createCounterSnapshot(client({ data: { token: 1 }, error: null }).client as never, "p1", 2)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("drift against the database's accepted shape", () => {
  it("sends exactly the keys the migration's shape check requires", () => {
    const dir = join(__dirname, "../../../../../supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_pharmacy_counter_adherence_snapshot.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file as string), "utf8");
    const match = sql.match(/c_keys constant text\[\] := array\[([^\]]+)\]/);
    const keys = (match?.[1] ?? "").split(",").map((k) => k.trim().replace(/'/g, "")).sort();
    expect(Object.keys(weeksForCounter([week(1)])[0]).sort()).toEqual(keys);
  });
});
