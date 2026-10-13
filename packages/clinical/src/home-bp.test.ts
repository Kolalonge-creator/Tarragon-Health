import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import {
  addLocalDays,
  assessHomeCheck,
  bandHomeMean,
  dedupeReadings,
  detectBpPattern,
  homeCheckSchedule,
  pairSessions,
  parseHomeBpConfig,
  sessionPartOf,
  statusAgainstTarget,
  type HomeBpReading,
} from "./home-bp";
import { BP_CARE_V3, BP_CARE_V4, grade, type TriageInput } from "./index";

// The configuration under test is the one value the registry and the migration seed share.
const RAW = JSON.parse(
  /home-bp-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(
    readFileSync(new URL("../../../supabase/migrations/" + readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).find((f) => f.endsWith("_s07x_home_bp_programme.sql"))!, import.meta.url), "utf8"),
  )![1]!,
);
const CFG = parseHomeBpConfig(1, RAW);
const ms = (iso: string) => Date.parse(iso);
const rd = (iso: string, s = 120, d = 80): HomeBpReading => ({ systolic: s, diastolic: d, atMs: ms(iso) });

/** The parity block lives in the database proof, so the SQL and TypeScript rules are held to the very same cases. */
const PARITY = JSON.parse(
  /parity-begin\s*insert into parity values \(\$json\$([\s\S]*?)\$json\$/.exec(
    readFileSync(new URL("../../db/tests/s07x_home_bp_programme.sql", import.meta.url), "utf8"),
  )![1]!,
) as {
  assess: { name: string; start: string; readings: { s: number; d: number; at: string }[]; expect: Record<string, unknown> }[];
  pattern: {
    name: string;
    clinic: { s: number; d: number; at: string };
    home: { s: number; d: number; end: string };
    treated: boolean;
    pregnant: boolean;
    age: number | null;
    expect: string | null;
  }[];
};

describe("home BP check: parity with the SQL rules (same cases as the database proof)", () => {
  it("has a meaningful number of cases", () => {
    expect(PARITY.assess.length).toBeGreaterThanOrEqual(15);
    expect(PARITY.pattern.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of PARITY.assess) {
    it(`assess: ${c.name}`, () => {
      const lastMs = c.readings.length ? Math.max(...c.readings.map((r) => ms(r.at))) : ms(`${c.start}T12:00:00Z`);
      const a = assessHomeCheck(
        { readings: c.readings.map((r) => ({ systolic: r.s, diastolic: r.d, atMs: ms(r.at) })), startDate: c.start, nowMs: lastMs },
        CFG,
      );
      expect({
        readings: a.readings,
        days: a.days,
        complete: a.complete,
        systolic: a.mean?.systolic ?? null,
        diastolic: a.mean?.diastolic ?? null,
        band: a.band,
      }).toEqual(c.expect);
    });
  }

  for (const c of PARITY.pattern) {
    it(`pattern: ${c.name}`, () => {
      expect(
        detectBpPattern(
          {
            clinic: { systolic: c.clinic.s, diastolic: c.clinic.d, atMs: ms(c.clinic.at) },
            home: { systolic: c.home.s, diastolic: c.home.d, endMs: ms(c.home.end) },
            treated: c.treated,
            pregnant: c.pregnant,
            ageYears: c.age,
          },
          CFG,
        ),
      ).toBe(c.expect);
    });
  }
});

describe("schedule, sessions and progress", () => {
  it("asks for a morning and an evening session on each of seven days", () => {
    const s = homeCheckSchedule("2026-10-01", CFG);
    expect(s).toHaveLength(14);
    expect(s[0]).toEqual({ date: "2026-10-01", part: "morning" });
    expect(s[1]).toEqual({ date: "2026-10-01", part: "evening" });
    expect(s[13]).toEqual({ date: "2026-10-07", part: "evening" });
  });

  it("names the session by the Lagos hour; outside both windows is no session", () => {
    expect(sessionPartOf(ms("2026-10-01T06:00:00Z"), CFG)).toBe("morning"); // 07:00 Lagos
    expect(sessionPartOf(ms("2026-10-01T03:00:00Z"), CFG)).toBe("morning"); // 04:00 Lagos, start inclusive
    expect(sessionPartOf(ms("2026-10-01T11:00:00Z"), CFG)).toBeNull(); // 12:00 Lagos, end exclusive
    expect(sessionPartOf(ms("2026-10-01T16:00:00Z"), CFG)).toBe("evening"); // 17:00 Lagos
    expect(sessionPartOf(ms("2026-10-01T23:30:00Z"), CFG)).toBeNull(); // 00:30 Lagos the next day
    expect(sessionPartOf(ms("2026-10-01T14:00:00Z"), CFG)).toBeNull(); // 15:00 Lagos
  });

  it("a session is done at two readings; a lone reading, or one outside the windows, fills nothing", () => {
    const done = pairSessions([rd("2026-10-01T06:00:00Z"), rd("2026-10-01T06:01:30Z"), rd("2026-10-01T18:00:00Z"), rd("2026-10-01T14:00:00Z"), rd("2026-10-01T14:02:00Z")], "2026-10-01", CFG);
    expect(done[0]).toMatchObject({ date: "2026-10-01", part: "morning", readings: 2, done: true });
    expect(done[1]).toMatchObject({ part: "evening", readings: 1, done: false });
    expect(done.filter((s) => s.done)).toHaveLength(1);
  });

  it("dedupes unsorted input and breaks ties on the instant by the values, so the result never depends on input order", () => {
    const kept = dedupeReadings([rd("2026-10-01T06:01:00Z"), rd("2026-10-01T06:00:00Z"), rd("2026-10-01T06:00:20Z"), rd("2026-10-01T06:00:00Z", 110, 70)], CFG);
    // 06:00:00 (110) is kept; the other 06:00:00 reading and the 06:00:20 one are within a minute of the reading before them; 06:01:00 follows 06:00:20 by 40 seconds
    expect(kept.map((r) => `${r.atMs}:${r.systolic}`)).toEqual([`${ms("2026-10-01T06:00:00Z")}:110`]);
    const sameSystolic = dedupeReadings([rd("2026-10-01T06:00:00Z", 120, 90), rd("2026-10-01T06:00:00Z", 120, 70)], CFG);
    expect(sameSystolic.map((r) => r.diastolic)).toEqual([70]);
  });

  it("keeps a reading exactly a minute after the previous one", () => {
    expect(dedupeReadings([rd("2026-10-01T06:00:00Z"), rd("2026-10-01T06:01:00Z"), rd("2026-10-01T06:01:59Z")], CFG)).toHaveLength(2);
  });

  it("adds local days across a month end", () => {
    expect(addLocalDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

describe("assessment progress", () => {
  const days = (n: number): HomeBpReading[] =>
    Array.from({ length: n }, (_, i) => [
      rd(`${addLocalDays("2026-10-01", i)}T06:00:00Z`, 118, 78),
      rd(`${addLocalDays("2026-10-01", i)}T06:01:30Z`, 118, 78),
      rd(`${addLocalDays("2026-10-01", i)}T18:00:00Z`, 118, 78),
      rd(`${addLocalDays("2026-10-01", i)}T18:01:30Z`, 118, 78),
    ]).flat();

  it("two days in: not enough, says what is missing, shows no average", () => {
    const a = assessHomeCheck({ readings: days(2), startDate: "2026-10-01", nowMs: ms("2026-10-02T20:00:00Z") }, CFG);
    expect(a).toMatchObject({ complete: false, mean: null, band: null, readings: 8, days: 2, dayNumber: 2, windowOver: false, sessionsDone: 4, sessionsExpected: 14 });
    expect(a.shortfall).toEqual({ moreReadings: 4, moreDays: 1 });
    expect(a.today.map((s) => s.part)).toEqual(["morning", "evening"]);
  });

  it("three days in: complete, an average and a band, nothing missing", () => {
    const a = assessHomeCheck({ readings: days(3), startDate: "2026-10-01", nowMs: ms("2026-10-03T20:00:00Z") }, CFG);
    expect(a).toMatchObject({ complete: true, shortfall: null, band: "within_home_target", mean: { systolic: 118, diastolic: 78 } });
  });

  it("the day number never goes below 1 or above the target, and the window is over after the last day", () => {
    const before = assessHomeCheck({ readings: [], startDate: "2026-10-05", nowMs: ms("2026-10-03T08:00:00Z") }, CFG);
    expect(before.dayNumber).toBe(1);
    const after = assessHomeCheck({ readings: [], startDate: "2026-10-01", nowMs: ms("2026-10-20T08:00:00Z") }, CFG);
    expect(after).toMatchObject({ dayNumber: 7, windowOver: true, windowEnd: "2026-10-07" });
    expect(after.shortfall).toEqual({ moreReadings: 12, moreDays: 3 });
  });
});

describe("bands and the personal target", () => {
  it("bands the complete average (C2)", () => {
    expect(bandHomeMean(135, 70, CFG)).toBe("above_home_level");
    expect(bandHomeMean(120, 85, CFG)).toBe("above_home_level");
    expect(bandHomeMean(134, 84, CFG)).toBe("borderline");
    expect(bandHomeMean(120, 80, CFG)).toBe("borderline");
    expect(bandHomeMean(129, 79, CFG)).toBe("within_home_target");
  });

  it("compares with a personal target and keeps whether a clinician set it", () => {
    expect(statusAgainstTarget(128, 76, { systolic: 130, diastolic: 80, confirmed: true })).toEqual({ status: "within_target", confirmed: true });
    expect(statusAgainstTarget(130, 70, { systolic: 130, diastolic: 80, confirmed: false })).toEqual({ status: "above_target", confirmed: false });
    expect(statusAgainstTarget(120, 80, { systolic: 130, diastolic: 80, confirmed: true }).status).toBe("above_target");
  });
});

describe("loading the configuration", () => {
  const clone = () => JSON.parse(JSON.stringify(RAW));
  it("loads the seed and keeps the version", () => {
    expect(CFG.version).toBe(1);
    expect(CFG.protocol.morningHours).toEqual([4, 12]);
  });
  it("refuses anything malformed", () => {
    expect(() => parseHomeBpConfig(1, null)).toThrow("must be an object");
    expect(() => parseHomeBpConfig(1, [])).toThrow("must be an object");
    for (const name of ["protocol", "bands", "pattern", "tasks"]) {
      const c = clone();
      delete c[name];
      expect(() => parseHomeBpConfig(1, c)).toThrow(`${name} must be an object`);
    }
    const bad = clone();
    bad.protocol.minReadings = 0;
    expect(() => parseHomeBpConfig(1, bad)).toThrow("protocol.minReadings");
    const fractional = clone();
    fractional.bands.aboveSystolic = 135.5;
    expect(() => parseHomeBpConfig(1, fractional)).toThrow("bands.aboveSystolic");
    const notNumber = clone();
    notNumber.pattern.windowDays = "30";
    expect(() => parseHomeBpConfig(1, notNumber)).toThrow("pattern.windowDays");
    for (const hours of ["x", [4], [4, 25], [12, 4], [1.5, 3], [-1, 3]]) {
      const c = clone();
      c.protocol.morningHours = hours;
      expect(() => parseHomeBpConfig(1, c)).toThrow("morningHours");
    }
    const days = clone();
    days.protocol.minDays = 8;
    expect(() => parseHomeBpConfig(1, days)).toThrow("minDays cannot exceed");
    const band = clone();
    band.bands.borderlineSystolic = 140;
    expect(() => parseHomeBpConfig(1, band)).toThrow("borderline band");
    const band2 = clone();
    band2.bands.borderlineDiastolic = 90;
    expect(() => parseHomeBpConfig(1, band2)).toThrow("borderline band");
  });
});

describe("bp_care_triage v4 draft (decision C5)", () => {
  const reading = (systolic: number, diastolic = 55) => ({ systolic, diastolic, takenAt: "2026-10-13T09:00:00Z" });
  const input = (systolic: number, extra: Partial<TriageInput> = {}): TriageInput => ({
    trigger: { type: "observation", reading: reading(systolic), symptoms: [], symptomsAnswered: true },
    history: [],
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: false,
    ageYears: 55,
    now: "2026-10-13T09:00:00Z",
    ...extra,
  });

  it("differs from v3 only in the version and rule BP-A7", () => {
    expect(BP_CARE_V4.version).toBe(4);
    expect(BP_CARE_V4.status).toBe("draft");
    expect(BP_CARE_V4.params).toEqual(BP_CARE_V3.params);
    expect(BP_CARE_V4.rules).toHaveLength(BP_CARE_V3.rules.length);
    const changed = BP_CARE_V4.rules.filter((r, i) => JSON.stringify(r) !== JSON.stringify(BP_CARE_V3.rules[i]));
    expect(changed.map((r) => r.id)).toEqual(["BP-A7"]);
  });

  it("v3 flags a low systolic with no symptom for everyone; v4 only for a patient on BP medicines", () => {
    const v3 = grade(input(85), BP_CARE_V3);
    expect(v3).toMatchObject({ grade: "amber", ruleId: "BP-A7" });
    const treated = grade(input(85, { onBpMedicines: true }), BP_CARE_V4);
    expect(treated).toMatchObject({ grade: "amber", ruleId: "BP-A7" });
    expect(treated.actions.map((a) => a.kind)).toContain("create_task");
    const untreated = grade(input(85, { onBpMedicines: false }), BP_CARE_V4);
    expect(untreated.ruleId).not.toBe("BP-A7");
    const unknown = grade(input(85), BP_CARE_V4);
    expect(unknown.ruleId).not.toBe("BP-A7");
    expect(unknown.actions.map((a) => a.kind)).not.toContain("create_task");
  });

  it("a low systolic with fainting is still red for everyone (BP-R3 is untouched)", () => {
    const i = input(85);
    const withFaint: TriageInput = { ...i, trigger: { ...(i.trigger as { type: "observation"; reading: ReturnType<typeof reading> }), symptoms: ["fainting"], symptomsAnswered: true } };
    expect(grade(withFaint, BP_CARE_V4)).toMatchObject({ grade: "red", ruleId: "BP-R3" });
  });

  it("every other reading grades exactly as v3 does", () => {
    for (const s of [95, 110, 125, 138, 150, 165, 185]) {
      const a = grade(input(s, { onBpMedicines: true }), BP_CARE_V3);
      const b = grade(input(s, { onBpMedicines: true }), BP_CARE_V4);
      expect({ ...b, ruleSet: a.ruleSet }).toEqual(a);
    }
  });

  it("the server seed derives the same v4 from the stored v3", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const sql = readFileSync(new URL(readdirSync(dir).find((f) => f.endsWith("_s07x_bp_care_triage_v4_draft.sql"))!, dir), "utf8");
    const when = JSON.parse(/'(\{"all":\[\{"field":"reading\.systolic"[^']*)'::jsonb/.exec(sql)![1]!);
    expect(when).toEqual(BP_CARE_V4.rules.find((r) => r.id === "BP-A7")!.when);
    expect(sql).toContain("where s.code = 'bp_care_triage' and s.version = 3");
    expect(sql).toContain("Systolic under 90 with no symptom, in a patient taking blood pressure medicines (CMO decision C5)");
  });
});
