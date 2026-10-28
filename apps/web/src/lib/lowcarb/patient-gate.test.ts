/**
 * S50b: the patient's door. One unavailable answer for every way the programme can be closed to someone, no reading or reason in the payload, and
 * an unreadable reading list never shows as a wall of "overdue".
 */
const vitals = jest.fn();
jest.mock("@/lib/clinical/vitals-audited", () => ({ readPatientVitalsAudited: (...a: unknown[]) => vitals(...a) }));

import { loadPatientLowCarb } from "./patient-gate";

const NOW = new Date("2026-10-21T12:00:00Z");
const rule = { per_week: 14, max_gap_days: 2 };
const ok = (status: string) => ({
  state: "ok",
  enrolment_id: "e1",
  status,
  check_ins: { glucose: rule, ketones: { per_week: 3, max_gap_days: 4 }, weight: { per_week: 1, max_gap_days: 9 } },
  low_glucose_below_mmol: 3.9,
});
const client = (answer: unknown) => ({ rpc: async () => answer }) as never;

beforeEach(() => vitals.mockReset());

describe("loadPatientLowCarb", () => {
  it.each([
    ["an rpc error", { data: null, error: { message: "x" } }],
    ["the unavailable answer", { data: { state: "unavailable" }, error: null }],
    ["no answer", { data: null, error: null }],
  ])("%s is unavailable", async (_name, answer) => {
    await expect(loadPatientLowCarb(client(answer), "p1", NOW)).resolves.toEqual({ state: "unavailable" });
    expect(vitals).not.toHaveBeenCalled();
  });

  it("an ok answer that cannot be read is an ERROR to retry, not unavailable", async () => {
    await expect(loadPatientLowCarb(client({ data: { state: "ok", status: "active" }, error: null }), "p1", NOW)).resolves.toEqual({ state: "error" });
    await expect(loadPatientLowCarb(client({ data: { ...ok("active"), status: "stopped" }, error: null }), "p1", NOW)).resolves.toEqual({ state: "error" });
  });

  it("malformed numbers degrade, they do not hide the screen: only a missing id or status is an error", async () => {
    const r = await loadPatientLowCarb(client({ data: { ...ok("active"), low_glucose_below_mmol: "3.9", check_ins: { glucose: 1 } }, error: null }), "p1", NOW);
    expect(r).toEqual({ state: "ok", enrolmentId: "e1", status: "active", lowLine: null, checkins: null });
  });

  it("with no signed rules someone on the programme still gets a screen, without the number", async () => {
    const ok2 = await loadPatientLowCarb(client({ data: { ...ok("paused"), low_glucose_below_mmol: null, check_ins: null }, error: null }), "p1", NOW);
    expect(ok2).toEqual({ state: "ok", enrolmentId: "e1", status: "paused", lowLine: null, checkins: null });
  });

  it("an offer needs no reading", async () => {
    await expect(loadPatientLowCarb(client({ data: ok("offered"), error: null }), "p1", NOW)).resolves.toEqual({
      state: "ok",
      enrolmentId: "e1",
      status: "offered",
      lowLine: 3.9,
      checkins: null,
    });
    expect(vitals).not.toHaveBeenCalled();
  });

  it("a paused programme shows the status and the low line, with no check-in lines and no reason", async () => {
    const r = await loadPatientLowCarb(client({ data: ok("paused"), error: null }), "p1", NOW);
    expect(r).toEqual({ state: "ok", enrolmentId: "e1", status: "paused", lowLine: 3.9, checkins: null });
    expect(JSON.stringify(r)).not.toMatch(/pause_code|ketone|triage|reason/);
  });

  it("an active programme counts this week's readings", async () => {
    vitals.mockImplementation(async (_c: unknown, _p: unknown, o: { vitalType: string }) => ({
      status: "ok",
      rows: o.vitalType === "glucose" ? [{ taken_at: "2026-10-21T08:00:00Z" }, { taken_at: "2026-10-20T08:00:00Z" }] : [],
    }));
    const r = await loadPatientLowCarb(client({ data: ok("active"), error: null }), "p1", NOW);
    expect(r.state === "ok" && r.checkins?.map((c) => `${c.metric}:${c.countThisWeek}:${c.status}`)).toEqual(["glucose:2:due", "ketones:0:overdue", "weight:0:overdue"]);
  });

  it("an unreadable reading list shows no check-in lines at all", async () => {
    vitals.mockResolvedValue({ status: "denied" });
    const r = await loadPatientLowCarb(client({ data: ok("active"), error: null }), "p1", NOW);
    expect(r.state === "ok" && r.checkins).toBeNull();
  });
});
