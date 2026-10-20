import { describe, expect, it, jest } from "@jest/globals";
import { slotsOn, parseScheduleSpec } from "@tarragon/medicines";
import { buildTodaysDoseChecklist } from "./checklist";
import { defaultsProfile, doseAnchorConfig, loadAnchors } from "./anchor-profile";

const DEFAULTS = doseAnchorConfig().defaults;
// Wednesday 7 October 2026, 09:00 Lagos.
const NOW = Date.parse("2026-10-07T08:00:00Z");
const base = { startDate: null, endDate: null, foodNote: null };
const breakfast = {
  id: "m1",
  drug_name: "Anchored",
  schedule_times: ["07:30"],
  schedule_spec: { ...base, kind: "daily", times: [], anchored: [{ anchor: "breakfast", offsetMinutes: 30 }] },
};

function client(opts: { times?: unknown; shifts?: unknown; timesError?: boolean; throws?: boolean }) {
  const q = (data: unknown, error: unknown) => {
    const o: Record<string, unknown> = { select: () => o, eq: () => o, then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(res) };
    return o;
  };
  return {
    from: (table: string) => {
      if (opts.throws) throw new Error("network");
      return table === "patient_dose_anchors"
        ? q(opts.timesError ? null : (opts.times ?? []), opts.timesError ? { message: "boom" } : null)
        : q(opts.shifts ?? [], null);
    },
  } as never;
}

describe("the configured anchor values", () => {
  it("load as ten times, whole-minute offsets and a shift length", () => {
    const c = doseAnchorConfig();
    expect(Object.keys(c.defaults)).toHaveLength(10);
    expect(c.offsetChoices).toContain(0);
    expect(c.shiftOffsetChoices).toContain(0);
    expect(c.maxShiftDays).toBeGreaterThan(0);
  });

  it("still load when the clock is behind the date the values took effect", () => {
    jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") });
    try {
      expect(() => doseAnchorConfig()).not.toThrow();
    } finally {
      jest.useRealTimers();
    }
  });

  it("the starting profile has no chosen times and no shifts", () => {
    expect(defaultsProfile()).toEqual({ defaults: DEFAULTS, times: {}, shifts: [] });
  });
});

describe("loading the patient's anchors", () => {
  it("builds the profile from the rows", async () => {
    const r = await loadAnchors(
      client({
        times: [{ anchor: "breakfast", effective_from: "2026-01-01", local_time: "08:00" }],
        shifts: [{ id: "s", starts_on: "2026-10-07", ends_on: "2026-10-07", offsets: { breakfast: 60 }, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }],
      }),
      "p1"
    );
    expect(r.loaded).toBe(true);
    expect(r.timeRows).toHaveLength(1);
    expect(r.shiftRows).toHaveLength(1);
    const spec = parseScheduleSpec(breakfast.schedule_spec, r.profile);
    if (!spec.ok) throw new Error("fixture");
    // 08:00 plus the 60 minute shift plus the dose's own 30 minutes, then back to normal the next day.
    expect(slotsOn(spec.spec, "2026-10-07").map((s) => s.time)).toEqual(["09:30"]);
    expect(slotsOn(spec.spec, "2026-10-08").map((s) => s.time)).toEqual(["08:30"]);
  });

  it("falls back to the proposed times and says it could not read the person's own, on an error or a thrown failure", async () => {
    for (const c of [client({ timesError: true }), client({ throws: true })]) {
      const r = await loadAnchors(c, "p1");
      expect(r.loaded).toBe(false);
      expect(r.profile).toEqual(defaultsProfile());
    }
  });

  it("treats a shift with no readable offsets as having none", async () => {
    const r = await loadAnchors(client({ shifts: [{ id: "s", starts_on: "2026-10-07", ends_on: "2026-10-07", offsets: null, cancelled_from: null, created_at: "2026-10-01T00:00:00Z" }] }), "p1");
    expect(r.loaded).toBe(true);
    expect(r.profile.shifts[0]?.offsets).toEqual({});
  });
});

describe("the Today checklist with anchored doses", () => {
  it("resolves an anchored dose at the proposed time with no profile, says which anchor it is, and follows the patient's own time", () => {
    const [d] = buildTodaysDoseChecklist([breakfast], [], NOW);
    const [h, m] = DEFAULTS.breakfast.split(":").map(Number);
    const total = (h ?? 0) * 60 + (m ?? 0) + 30;
    expect(d?.time).toBe(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
    expect(d?.anchored).toEqual({ anchor: "breakfast", offsetMinutes: 30 });

    const own = defaultsProfile();
    const mine = { ...own, times: { breakfast: [{ effectiveFrom: "2026-01-01", time: "08:15" }] } };
    expect(buildTodaysDoseChecklist([breakfast], [], NOW, mine)[0]?.time).toBe("08:45");
  });

  it("matches a logged answer against the resolved time", () => {
    const mine = { ...defaultsProfile(), times: { breakfast: [{ effectiveFrom: "2026-01-01", time: "08:15" }] } };
    const items = buildTodaysDoseChecklist([breakfast], [{ medication_id: "m1", scheduled_time: "08:45", status: "taken" }], NOW, mine);
    expect(items[0]?.status).toBe("taken");
  });

  it("a plain clock-time medicine is unchanged and carries no anchor", () => {
    const [d] = buildTodaysDoseChecklist([{ id: "m2", drug_name: "Plain", schedule_times: ["08:00"] }], [], NOW);
    expect(d).toEqual({ medicationId: "m2", drugName: "Plain", time: "08:00", status: "pending" });
  });
});
