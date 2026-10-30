import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { assessHomeCheck, parseHomeBpConfig, type HomeBpReading } from "./home-bp";
import { buildHomeBpClinicianSummary, preMeasureChecklist, sessionTracker } from "./home-bp-guide";

// The same configuration the programme migration seeds (PROPOSED, unsigned): every number below comes from it, none is typed here.
const RAW = JSON.parse(
  /home-bp-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(
    readFileSync(new URL("../../../supabase/migrations/" + readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).find((f) => f.endsWith("_s07x_home_bp_programme.sql"))!, import.meta.url), "utf8"),
  )![1]!,
);
const CFG = parseHomeBpConfig(1, RAW);
const ms = (iso: string) => Date.parse(iso);
const rd = (iso: string, s = 130, d = 82): HomeBpReading => ({ systolic: s, diastolic: d, atMs: ms(iso) });
const START = "2026-10-12";

/** Morning 08:00 and 08:02 and evening 19:00 and 19:02 Lagos (UTC+1) each day, for `days` days. */
function fullDays(days: number, s = 130, d = 82): HomeBpReading[] {
  const out: HomeBpReading[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = String(12 + i).padStart(2, "0");
    for (const t of ["07:00:00Z", "07:02:00Z", "18:00:00Z", "18:02:00Z"]) out.push(rd(`2026-10-${day}T${t}`, s + i, d));
  }
  return out;
}

describe("preMeasureChecklist", () => {
  it("takes the rest time and the avoid time from the configuration, not from the code", () => {
    const list = preMeasureChecklist(CFG);
    expect(list.map((i) => i.id)).toEqual(["seated", "rested", "arm", "cuff", "avoid"]);
    expect(list.find((i) => i.id === "rested")?.params).toEqual({ minutes: CFG.protocol.restMinutes });
    expect(list.find((i) => i.id === "avoid")?.params).toEqual({ minutes: CFG.protocol.avoidBeforeMinutes });
    const changed = preMeasureChecklist({ ...CFG, protocol: { ...CFG.protocol, restMinutes: 9 } });
    expect(changed.find((i) => i.id === "rested")?.params).toEqual({ minutes: 9 });
  });

  it("every key is a hbp.prep message", () => {
    for (const item of preMeasureChecklist(CFG)) expect(item.key.startsWith("hbp.prep.")).toBe(true);
  });
});

describe("sessionTracker", () => {
  it("has a morning and an evening cell for each of the configured days", () => {
    const cells = sessionTracker([], START, ms("2026-10-12T05:00:00Z"), CFG);
    expect(cells).toHaveLength(CFG.protocol.targetDays * 2);
    expect(cells[0]).toMatchObject({ date: START, part: "morning" });
    expect(cells[1]).toMatchObject({ date: START, part: "evening" });
  });

  it("marks a filled session done, a closed empty one missed and a future one todo", () => {
    const readings = [rd("2026-10-12T07:00:00Z"), rd("2026-10-12T07:02:00Z")]; // day 1 morning, two readings, 08:00 Lagos
    const now = ms("2026-10-13T11:00:00Z"); // day 2, 12:00 Lagos: the morning window has just closed
    const cells = sessionTracker(readings, START, now, CFG);
    expect(cells.find((c) => c.date === "2026-10-12" && c.part === "morning")?.state).toBe("done");
    expect(cells.find((c) => c.date === "2026-10-12" && c.part === "evening")?.state).toBe("missed");
    expect(cells.find((c) => c.date === "2026-10-13" && c.part === "morning")?.state).toBe("missed");
    expect(cells.find((c) => c.date === "2026-10-13" && c.part === "evening")?.state).toBe("todo");
    expect(cells.find((c) => c.date === "2026-10-14" && c.part === "morning")?.state).toBe("todo");
  });

  it("a single reading in a session is not done (the protocol asks for the configured number)", () => {
    const cells = sessionTracker([rd("2026-10-12T07:00:00Z")], START, ms("2026-10-12T09:00:00Z"), CFG);
    expect(cells[0]).toMatchObject({ state: "todo", readings: 1 });
  });

  it("two readings less than the minimum gap apart count as one, so the session is not done", () => {
    const cells = sessionTracker([rd("2026-10-12T07:00:00Z"), rd("2026-10-12T07:00:20Z")], START, ms("2026-10-12T09:00:00Z"), CFG);
    expect(cells[0]).toMatchObject({ state: "todo", readings: 1 });
  });
});

describe("buildHomeBpClinicianSummary", () => {
  const NOW = ms("2026-10-19T12:00:00Z");

  it("a full seven days is complete, with the average, the range, the count and the sessions", () => {
    const s = buildHomeBpClinicianSummary(fullDays(7), START, NOW, CFG);
    expect(s.complete).toBe(true);
    expect(s.readings).toBe(28);
    expect(s.days).toBe(7);
    expect(s.sessionsDone).toBe(14);
    expect(s.sessionsExpected).toBe(14);
    expect(s.range).toEqual({ systolic: { min: 130, max: 136 }, diastolic: { min: 82, max: 82 } });
    expect(s.average).toEqual({ systolic: 133, diastolic: 82 });
    expect(s.configVersion).toBe(1);
  });

  it("agrees with the programme's own assessment on the count, the average and completeness (it cannot drift from the patient's card)", () => {
    const readings = fullDays(5);
    const a = assessHomeCheck({ readings, startDate: START, nowMs: NOW }, CFG);
    const s = buildHomeBpClinicianSummary(readings, START, NOW, CFG);
    expect([s.readings, s.days, s.complete, s.average, s.band]).toEqual([a.readings, a.days, a.complete, a.mean, a.band]);
  });

  it("below the minimum there is NO average, but the range and the shortfall are still shown", () => {
    const readings = [rd("2026-10-12T07:00:00Z", 150, 95), rd("2026-10-12T07:02:00Z", 120, 78)];
    const s = buildHomeBpClinicianSummary(readings, START, NOW, CFG);
    expect(s.complete).toBe(false);
    expect(s.average).toBeNull();
    expect(s.band).toBeNull();
    expect(s.range).toEqual({ systolic: { min: 120, max: 150 }, diastolic: { min: 78, max: 95 } });
    expect(s.readings).toBe(2);
    expect(s.minReadings).toBe(CFG.protocol.minReadings);
    expect(s.minDays).toBe(CFG.protocol.minDays);
  });

  it("no readings at all gives an empty, incomplete summary and no range", () => {
    const s = buildHomeBpClinicianSummary([], START, NOW, CFG);
    expect(s).toMatchObject({ readings: 0, days: 0, complete: false, average: null, range: null });
  });

  it("readings outside the window are not counted, and a repeat inside the minimum gap does not widen the range", () => {
    const readings = [
      rd("2026-10-11T07:00:00Z", 200, 120), // the day before the window
      rd("2026-10-12T07:00:00Z", 130, 80),
      rd("2026-10-12T07:00:20Z", 190, 110), // inside the minimum gap: the same measurement saved twice
    ];
    const s = buildHomeBpClinicianSummary(readings, START, NOW, CFG);
    expect(s.readings).toBe(1);
    expect(s.range).toEqual({ systolic: { min: 130, max: 130 }, diastolic: { min: 80, max: 80 } });
  });
});
