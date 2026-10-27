import { getProposedConfig } from "@tarragon/shared";
import { loadWeeklyCards } from "./weekly-cards";

jest.mock("@/lib/medicines/adherence-report-data", () => ({
  loadAdherenceReport: jest.fn(async () => ({
    ok: true,
    data: { weeks: [{ due: 14, markedTaken: 12, percent: 86 }], minDoses: 3, generatedAtMs: 0, hasScheduledMedicines: true },
  })),
}));

const NOW = Date.parse("2026-10-21T10:00:00Z");
const CONFIG = { version: 1, config: getProposedConfig("today.home_cards").value };

type Result = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Result => ({ data, error: null });
const fail: Result = { data: null, error: { message: "boom" } };

function client(opts: { config?: Result; bp?: Result; target?: Result; activity?: Result; meals?: Result }) {
  const table = (res: Result) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "is"]) chain[m] = () => chain;
    chain["then"] = (resolve: (r: Result) => void) => resolve(res);
    return chain;
  };
  return {
    rpc: (name: string) => {
      if (name === "my_home_card_config") return Promise.resolve(opts.config ?? ok(CONFIG));
      if (name === "my_home_bp_target") return Promise.resolve(opts.target ?? ok([{ systolic: 135, diastolic: 85 }]));
      return Promise.resolve(opts.activity ?? ok({ active_minutes: 60, weekly_active_minutes_goal: 150 }));
    },
    from: (name: string) =>
      table(
        name === "vitals_readings"
          ? (opts.bp ?? ok([
              { systolic: 120, diastolic: 78, source: "manual", taken_at: "2026-10-20T08:00:00Z" },
              { systolic: 150, diastolic: 95, source: "manual", taken_at: "2026-10-19T08:00:00Z" },
              { systolic: 118, diastolic: 76, source: "manual", taken_at: "2026-10-18T08:00:00Z" },
              { systolic: 100, diastolic: 60, source: "wearable", taken_at: "2026-10-18T09:00:00Z" },
            ]))
          : (opts.meals ?? ok([{ logged_at: "2026-10-20T08:00:00Z" }, { logged_at: "2026-10-20T13:00:00Z" }, { logged_at: "2026-10-19T08:00:00Z" }, { logged_at: null }])),
      ),
  } as never;
}

describe("loadWeeklyCards", () => {
  it("is hidden until the configuration is signed", async () => {
    expect(await loadWeeklyCards(client({ config: ok(null) }), "p", NOW)).toEqual({ state: "hidden" });
    expect(await loadWeeklyCards(client({ config: fail }), "p", NOW)).toEqual({ state: "hidden" });
  });

  it("is hidden when the signed configuration leaves the weekly summary card out", async () => {
    const value = getProposedConfig("today.home_cards").value as { cards: { code: string }[] };
    const without = { ...value, cards: value.cards.filter((c) => c.code !== "weekly_summary") };
    expect(await loadWeeklyCards(client({ config: ok({ version: 1, config: without }) }), "p", NOW)).toEqual({ state: "hidden" });
  });

  it("is hidden when the signed configuration cannot be read", async () => {
    expect(await loadWeeklyCards(client({ config: ok({ version: 1, config: { weekly: { min_bp_readings: 0, window_days: 7 } } }) }), "p", NOW)).toEqual({ state: "hidden" });
  });

  it("builds four cards from the places the platform already reads, leaving a wearable estimate out of blood pressure", async () => {
    const r = await loadWeeklyCards(client({}), "p", NOW);
    expect(r.state).toBe("ready");
    if (r.state !== "ready") return;
    const byCode = Object.fromEntries(r.summary.cards.map((c) => [c.code, c]));
    expect(byCode["blood_pressure"]?.line).toEqual({ key: "weekly.bp.ready", params: { count: 3, under: 2 } });
    expect(byCode["activity"]?.line.params).toEqual({ minutes: 60, goal: 150 });
    expect(byCode["meals"]?.line.params).toEqual({ days: 2 });
    expect(byCode["medicines"]?.line.params).toEqual({ taken: 12, due: 14 });
  });

  it("leaves a source that failed out instead of showing a zero", async () => {
    const r = await loadWeeklyCards(client({ bp: fail, meals: fail, activity: fail }), "p", NOW);
    expect(r.state === "ready" && r.summary.cards.map((c) => c.code)).toEqual(["medicines"]);
  });

  it("compares with nothing when there is no target", async () => {
    const r = await loadWeeklyCards(client({ target: ok([]) }), "p", NOW);
    expect(r.state === "ready" && r.summary.cards[0]?.line.key).toBe("weekly.bp.no_target");
  });

  it("ignores an activity answer that is not an object", async () => {
    const r = await loadWeeklyCards(client({ activity: ok([1]), target: fail }), "p", NOW);
    expect(r.state === "ready" && r.summary.cards.map((c) => c.code)).toEqual(["blood_pressure", "meals", "medicines"]);
  });
});
