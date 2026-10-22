/**
 * The supported eating programme on the phone (S50b). The database doors decide everything; these tests pin that the app reads them faithfully:
 * a closed gate shows nothing, a FAILED load is a different state from "unavailable", the Stop button and the low-sugar card follow the database's answer
 * only, and answering is never queued. The doors themselves are proven in packages/db/tests/s50b_lowcarb_t2d_programme.sql.
 */
import { supabase } from "./supabase";
import { hasLowCarbProgramme, loadLowCarb, lowCarbPanels, parseLowCarbOk, respondToLowCarbOffer, stopLowCarbProgramme } from "./lowcarb";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;

const NOW = new Date("2026-10-21T12:00:00Z");
const rule = { per_week: 14, max_gap_days: 2 };
const ok = (status: string) => ({
  state: "ok",
  enrolment_id: "e1",
  status,
  check_ins: { glucose: rule, ketones: { per_week: 3, max_gap_days: 4 }, weight: { per_week: 1, max_gap_days: 9 } },
  low_glucose_below_mmol: 3.9,
});

function readings(rows: unknown, error: unknown = null) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "gte", "order"]) q[m] = () => q;
  q.limit = async () => ({ data: rows, error });
  from.mockReturnValue(q);
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("parseLowCarbOk", () => {
  it("reads a complete ok answer", () => {
    expect(parseLowCarbOk(ok("active"))).toMatchObject({ enrolmentId: "e1", status: "active", lowLine: 3.9 });
  });
  it.each([
    ["unavailable", { state: "unavailable" }],
    ["null", null],
    ["a string", "ok"],
    ["no enrolment id", { ...ok("active"), enrolment_id: undefined }],
    ["an unknown status", ok("stopped")],
  ])("%s is not a programme", (_name, data) => {
    expect(parseLowCarbOk(data)).toBeNull();
  });
});

describe("an ok answer with missing numbers", () => {
  it("malformed numbers degrade, they do not hide the programme", () => {
    expect(parseLowCarbOk({ ...ok("active"), low_glucose_below_mmol: "3.9", check_ins: { glucose: 1 } })).toMatchObject({ status: "active", lowLine: null, rules: null });
  });
  it("is still a programme (no number, no check-in lines) when the rules are not live", () => {
    expect(parseLowCarbOk({ ...ok("paused"), low_glucose_below_mmol: null, check_ins: null })).toMatchObject({ status: "paused", lowLine: null, rules: null });
  });
});

describe("loadLowCarb", () => {
  it("an ok answer without an id or status is an ERROR to retry, not unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "ok", status: "active" }, error: null });
    await expect(loadLowCarb("p1", NOW)).resolves.toEqual({ kind: "error", offline: false });
  });

  it("every closed case is the same unavailable answer", async () => {
    for (const data of [{ state: "unavailable" }, null, {}, "x"]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(loadLowCarb("p1", NOW)).resolves.toEqual({ kind: "unavailable" });
    }
    expect(from).not.toHaveBeenCalled();
  });

  it("a failed load is an ERROR, never unavailable, and says whether we are offline", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(loadLowCarb("p1", NOW)).resolves.toEqual({ kind: "error", offline: false });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Network request failed" } });
    await expect(loadLowCarb("p1", NOW)).resolves.toEqual({ kind: "error", offline: true });
  });

  it("an offer needs no readings", async () => {
    rpc.mockResolvedValueOnce({ data: ok("offered"), error: null });
    await expect(loadLowCarb("p1", NOW)).resolves.toEqual({ kind: "ok", enrolmentId: "e1", status: "offered", lowLine: 3.9, checkins: null });
    expect(from).not.toHaveBeenCalled();
  });

  it("a paused programme shows no check-in lines and carries no reason", async () => {
    rpc.mockResolvedValueOnce({ data: ok("paused"), error: null });
    const r = await loadLowCarb("p1", NOW);
    expect(r).toEqual({ kind: "ok", enrolmentId: "e1", status: "paused", lowLine: 3.9, checkins: null });
    expect(JSON.stringify(r)).not.toMatch(/pause_code|ketone|triage|reason/);
  });

  it("an active programme counts this week's readings", async () => {
    rpc.mockResolvedValueOnce({ data: ok("active"), error: null });
    readings([
      { vital_type: "glucose", taken_at: "2026-10-21T08:00:00Z" },
      { vital_type: "glucose", taken_at: "2026-10-20T08:00:00Z" },
      { vital_type: "blood_pressure", taken_at: "2026-10-21T08:00:00Z" },
    ]);
    const r = await loadLowCarb("p1", NOW);
    expect(r.kind === "ok" && r.checkins?.map((c) => `${c.metric}:${c.countThisWeek}:${c.status}`)).toEqual(["glucose:2:due", "ketones:0:overdue", "weight:0:overdue"]);
  });

  it("an unreadable reading list shows no lines, not a wall of overdue", async () => {
    rpc.mockResolvedValueOnce({ data: ok("active"), error: null });
    readings(null, { message: "boom" });
    const r = await loadLowCarb("p1", NOW);
    expect(r.kind === "ok" && r.checkins).toBeNull();
  });
});

describe("hasLowCarbProgramme (the quiet link)", () => {
  it("is true only for an ok answer", async () => {
    rpc.mockResolvedValueOnce({ data: ok("offered"), error: null });
    await expect(hasLowCarbProgramme()).resolves.toBe(true);
  });
  it("is true for a half-readable ok (the screen then says it could not load)", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "ok", status: "active" }, error: null });
    await expect(hasLowCarbProgramme()).resolves.toBe(true);
  });
  it("is false for a closed gate and for an error, so nothing is advertised", async () => {
    rpc.mockResolvedValueOnce({ data: { state: "unavailable" }, error: null });
    await expect(hasLowCarbProgramme()).resolves.toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    await expect(hasLowCarbProgramme()).resolves.toBe(false);
  });
});

describe("lowCarbPanels (what the screen shows)", () => {
  const okView = (status: "offered" | "active" | "paused") => ({ kind: "ok" as const, enrolmentId: "e1", status, lowLine: 3.9, checkins: null });

  it("a closed gate shows no programme card at all", () => {
    const p = lowCarbPanels({ kind: "unavailable" });
    expect(p).toMatchObject({ unavailable: true, error: false, offer: false, checkin: false, paused: false, lowCard: false, contact: false, stop: false });
  });

  it("a load failure is not the closed-gate state", () => {
    const p = lowCarbPanels({ kind: "error", offline: true });
    expect(p).toMatchObject({ error: true, unavailable: false, stop: false });
  });

  it("loading is its own state", () => {
    expect(lowCarbPanels(null)).toMatchObject({ loading: true, error: false, unavailable: false });
  });

  it("an offer shows the offer and nothing that belongs to a running programme", () => {
    expect(lowCarbPanels(okView("offered"))).toMatchObject({ offer: true, checkin: false, lowCard: false, contact: false, stop: false });
  });

  it("an active programme shows the check-in, the low-sugar card, contact and Stop", () => {
    expect(lowCarbPanels(okView("active"))).toMatchObject({ checkin: true, paused: false, lowCard: true, contact: true, stop: true });
  });

  it("a paused programme keeps the low-sugar card, contact and Stop (the safety content never goes)", () => {
    expect(lowCarbPanels(okView("paused"))).toMatchObject({ paused: true, checkin: false, lowCard: true, contact: true, stop: true });
  });
});

describe("answering and stopping are never queued", () => {
  it("accepts, declines, and reports an offer that has lapsed as unavailable", async () => {
    rpc.mockResolvedValueOnce({ data: "active", error: null });
    await expect(respondToLowCarbOffer("e1", true)).resolves.toEqual({ ok: true, outcome: "active" });
    expect(rpc).toHaveBeenLastCalledWith("respond_lowcarb_offer", { p_enrolment: "e1", p_accept: true });
    rpc.mockResolvedValueOnce({ data: "declined", error: null });
    await expect(respondToLowCarbOffer("e1", false)).resolves.toEqual({ ok: true, outcome: "declined" });
    rpc.mockResolvedValueOnce({ data: "unavailable", error: null });
    await expect(respondToLowCarbOffer("e1", true)).resolves.toEqual({ ok: true, outcome: "unavailable" });
  });

  it("offline or an error changes nothing and says so; an unreadable reply is never accepted", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Network request failed" } });
    await expect(respondToLowCarbOffer("e1", true)).resolves.toEqual({ ok: false, key: "lowcarb.offline" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(respondToLowCarbOffer("e1", true)).resolves.toEqual({ ok: false, key: "lowcarb.error.action" });
    rpc.mockResolvedValueOnce({ data: "active-ish", error: null });
    await expect(respondToLowCarbOffer("e1", true)).resolves.toEqual({ ok: false, key: "lowcarb.error.action" });
  });

  it("refuses an empty id without calling the database", async () => {
    await expect(respondToLowCarbOffer("", true)).resolves.toEqual({ ok: false, key: "lowcarb.error.action" });
    await expect(stopLowCarbProgramme("")).resolves.toEqual({ ok: false, key: "lowcarb.error.action" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops through the one function, and a failure changes nothing", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(stopLowCarbProgramme("e1")).resolves.toEqual({ ok: true, outcome: "stopped" });
    expect(rpc).toHaveBeenLastCalledWith("stop_lowcarb_programme", { p_enrolment: "e1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Network request failed" } });
    await expect(stopLowCarbProgramme("e1")).resolves.toEqual({ ok: false, key: "lowcarb.offline" });
  });
});
