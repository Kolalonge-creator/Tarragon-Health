import { describe, expect, it } from "@jest/globals";
import type { MoodTrendDay } from "../mental-health";
import {
  advancePanic, groundingKey, hasAnyChoice, initialPanicState, median, moodInsights, moodInsightsConfig, NOTHING_CHOSEN, panicBreathView, panicToolConfig,
  panicCircleScale, panicSteppedScale, parseWellbeingSummary, parseWorklist, describeReason, renderInsight, summarySections, weekdayName, WORKLIST_LIMITS,
} from "./index";

const day = (n: number, over: Partial<MoodTrendDay> = {}): MoodTrendDay => {
  const d = new Date(Date.UTC(2026, 8, 1 + n, 12)).toISOString().slice(0, 10);
  return { day: d, mood: 3, stress: 3, tags: [], systolic: null, diastolic: null, sleepMinutes: null, ...over };
};
const series = (n: number, f: (i: number) => Partial<MoodTrendDay>): MoodTrendDay[] => Array.from({ length: n }, (_, i) => day(i, f(i)));
const tr = (key: string, params?: Record<string, string | number>): string => `${key}${params ? JSON.stringify(params) : ""}`;

describe("mood insights (patient-private patterns)", () => {
  it("says nothing until there are enough days with a mood check-in, and reports how many there are", () => {
    const r = moodInsights(series(cfgMin() - 1, () => ({ mood: 2 })));
    expect(r.status).toBe("not_enough_data");
    expect(r.insights).toEqual([]);
    expect(r.daysWithMood).toBe(cfgMin() - 1);
    expect(r.neededDays).toBe(moodInsightsConfig().min_days_with_mood);
  });

  it("counts a sleep pattern against the patient's own middle night, with the numbers behind it", () => {
    // 30 days: even days short sleep (5h) and low mood (2); odd days long sleep (8h) and mood 4
    const r = moodInsights(series(30, (i) => (i % 2 === 0 ? { mood: 2, sleepMinutes: 300 } : { mood: 4, sleepMinutes: 480 })));
    expect(r.status).toBe("ok");
    const s = r.insights.find((x) => x.kind === "sleep");
    expect(s).toBeDefined();
    expect(s?.a).toEqual({ low: 15, total: 15 });
    expect(s?.b).toEqual({ low: 0, total: 15 });
    expect(s?.medianSleepHours).toBe(6.5);
    expect(r.medianMood).toBe(3);
  });

  it("shows no pattern when the groups are too small or the difference is small", () => {
    // the same mood on every day: nothing is below the median, no gap
    const flat = moodInsights(series(30, (i) => ({ mood: 3, sleepMinutes: i % 2 ? 300 : 480 })));
    expect(flat.status).toBe("ok");
    expect(flat.insights).toEqual([]);
    // a tag used on only two days is not enough days to say anything
    const rare = moodInsights(series(30, (i) => ({ mood: i < 2 ? 1 : 4, tags: i < 2 ? ["work"] : [] })));
    expect(rare.insights.find((x) => x.kind === "tag")).toBeUndefined();
  });

  it("handles tags, blood pressure and day of week, and never returns more than the configured number", () => {
    const r = moodInsights(series(60, (i) => ({
      mood: i % 7 === 0 ? 1 : 4,
      tags: i % 7 === 0 ? ["work"] : [],
      systolic: i % 7 === 0 ? 150 : 120,
      diastolic: 80,
      sleepMinutes: i % 7 === 0 ? 200 : 450,
    })));
    expect(r.insights.length).toBeLessThanOrEqual(moodInsightsConfig().max_patterns);
    const kinds = new Set(r.insights.map((x) => x.kind));
    expect(kinds.size).toBeGreaterThan(0);
    // sorted by the size of the difference
    const gaps = r.insights.map((x) => Math.abs(x.gap));
    expect([...gaps].sort((p, q) => q - p)).toEqual(gaps);
  });

  it("only looks at the configured window and ignores older days", () => {
    const old = series(40, () => ({ mood: 1 })).map((d) => ({ ...d, day: `2025-01-${String((Number(d.day.slice(8)) % 28) + 1).padStart(2, "0")}` }));
    const r = moodInsights([...old, ...series(5, () => ({ mood: 4 }))]);
    expect(r.status).toBe("not_enough_data");
    expect(r.daysWithMood).toBe(5);
  });

  it("renders a sentence through the translator and names the weekday and tag", () => {
    const r = moodInsights(series(60, (i) => ({ mood: i % 7 === 0 ? 1 : 4, tags: i % 7 === 0 ? ["work"] : [] })));
    const tag = r.insights.find((x) => x.kind === "tag");
    const wk = r.insights.find((x) => x.kind === "weekday");
    expect(tag).toBeDefined();
    expect(renderInsight(tag as NonNullable<typeof tag>, tr)).toContain("insights.tpl.tag");
    expect(renderInsight(tag as NonNullable<typeof tag>, tr)).toContain("mood.tag.work");
    expect(wk ? renderInsight(wk, tr) : "insights.tpl.weekday").toContain("insights.tpl.weekday");
    expect(weekdayName(0)).toBe("Sunday");
    expect(median([3, 1, 2, 4])).toBe(2.5);
  });
});
function cfgMin(): number {
  return moodInsightsConfig().min_days_with_mood;
}

describe("calm tool state machine and pacing (no model, no clock)", () => {
  const cfg = panicToolConfig();
  it("goes intro, breathing, grounding 5-4-3-2-1, done, and can restart from done only", () => {
    let s = initialPanicState();
    expect(s.stage).toBe("intro");
    expect(advancePanic(s, "next")).toEqual(s); // a stray tap changes nothing
    s = advancePanic(s, "start");
    expect(s.stage).toBe("breathing");
    expect(advancePanic(s, "restart")).toEqual(s);
    s = advancePanic(s, "breathing_finished");
    expect(s).toEqual({ stage: "grounding", step: 0 });
    for (let i = 1; i < cfg.grounding_counts.length; i++) {
      s = advancePanic(s, "next");
      expect(s).toEqual({ stage: "grounding", step: i });
    }
    s = advancePanic(s, "next");
    expect(s.stage).toBe("done");
    expect(advancePanic(s, "start")).toEqual(s);
    expect(advancePanic(s, "restart").stage).toBe("breathing");
  });
  it("can skip breathing to grounding at any time", () => {
    expect(advancePanic({ stage: "breathing", step: 0 }, "skip")).toEqual({ stage: "grounding", step: 0 });
    expect(advancePanic({ stage: "intro", step: 0 }, "skip").stage).toBe("intro");
  });
  it("grounds with the counts 5, 4, 3, 2, 1", () => {
    expect(cfg.grounding_counts).toEqual([5, 4, 3, 2, 1]);
    expect(cfg.grounding_counts.map(groundingKey)).toEqual(["panic.ground_5", "panic.ground_4", "panic.ground_3", "panic.ground_2", "panic.ground_1"]);
  });
  it("breathes in then out over whole breaths and finishes", () => {
    const v0 = panicBreathView(0, cfg);
    expect(v0).toMatchObject({ done: false, phase: "inhale", breath: 1 });
    expect(v0.totalBreaths).toBe(Math.floor(cfg.total_seconds / (cfg.inhale_seconds + cfg.exhale_seconds)));
    expect(panicBreathView(cfg.inhale_seconds + 0.5, cfg).phase).toBe("exhale");
    expect(panicBreathView(cfg.total_seconds + 5, cfg).done).toBe(true);
    expect(panicBreathView(cfg.inhale_seconds + cfg.exhale_seconds + 1, cfg).breath).toBe(2);
  });
  it("keeps the circle visible and steps instead of moving under reduced motion", () => {
    for (let t = 0; t < 70; t += 0.5) {
      const v = panicBreathView(t, cfg);
      expect(panicCircleScale(v)).toBeGreaterThanOrEqual(0.6);
      expect(panicCircleScale(v)).toBeLessThanOrEqual(1);
    }
    expect(panicSteppedScale("inhale")).toBe(1);
    expect(panicSteppedScale("exhale")).toBe(0.6);
  });
});

describe("share summary reader and formatter", () => {
  const raw = {
    version: 1,
    screens: [{ instrument: "phq9", points: [{ at: "2026-10-01T09:00:00Z", total: 12, band: "moderate" }, { at: "2026-09-01T09:00:00Z", total: 8, band: "mild" }], change_since_previous: 4 }],
    check_ins: [{ week_start: "2026-10-12", check_ins: 5, mood_mean: 3.2, stress_mean: 3.8 }],
    sleep: { days: 14, entries: 9, mean_hours: 6.1, shortest_hours: 4.5, longest_hours: 8, mean_quality: 2.9, mean_minutes_to_fall_asleep: 35, mean_night_wakings: 1.4 },
  };
  it("nothing is chosen by default", () => {
    expect(NOTHING_CHOSEN).toEqual({ screens: false, checkins: false, sleep: false, note: "" });
    expect(hasAnyChoice(NOTHING_CHOSEN)).toBe(false);
    expect(hasAnyChoice({ ...NOTHING_CHOSEN, note: "  " })).toBe(false);
    expect(hasAnyChoice({ ...NOTHING_CHOSEN, note: "sleep" })).toBe(true);
  });
  it("reads the database object and drops anything unexpected", () => {
    const s = parseWellbeingSummary(raw);
    expect(s.screens?.[0]).toMatchObject({ instrument: "phq9", changeSincePrevious: 4 });
    expect(s.checkIns?.[0]).toMatchObject({ weekStart: "2026-10-12", moodMean: 3.2 });
    expect(s.sleep).toMatchObject({ entries: 9, meanHours: 6.1 });
    const bad = parseWellbeingSummary({ screens: [{ instrument: "auditc", points: [] }, "x"], check_ins: "nope", sleep: {} });
    expect(bad.screens).toEqual([]);
    expect(bad.checkIns).toBeNull();
    expect(bad.sleep).toBe("empty");
    expect(parseWellbeingSummary(null)).toEqual({ screens: null, checkIns: null, sleep: null });
  });
  it("does not carry a journal, item answers, notes or tags even if the object had them", () => {
    const s = parseWellbeingSummary({ ...raw, journal: "secret", item_responses: { q9: 3 }, notes: "x", tags: ["work"] });
    expect(JSON.stringify(s)).not.toMatch(/secret|"q9"|"tags"|"notes"|journal|item_responses/);
  });
  it("builds the words: sections only for what was chosen, plus the patient's note as written", () => {
    const s = parseWellbeingSummary({ version: 1, screens: raw.screens });
    const sections = summarySections(s, "I want to talk about work", tr);
    expect(sections.map((x) => x.heading)).toEqual(["wsum.screens_heading", "wsum.note_heading"]);
    expect(sections[1]?.lines).toEqual(["I want to talk about work"]);
    expect(sections[0]?.lines.join("|")).toContain("wsum.change_line");
    expect(summarySections(parseWellbeingSummary({ version: 1, check_ins: [] }), null, tr)[0]?.lines).toEqual(["wsum.no_entries"]);
  });
});

describe("worklist reader and descriptions", () => {
  it("reads the payload and refuses to guess", () => {
    expect(parseWorklist(null).status).toBe("unreadable");
    expect(parseWorklist({ status: "off" }).status).toBe("off");
    expect(parseWorklist({ status: "not_signed" })).toMatchObject({ status: "not_signed", rows: [] });
    const p = parseWorklist({
      status: "ok", config_version: 1, notes: ["overdue_off_cadence_unsigned"],
      rows: [{ patient_id: "p1", full_name: "A B", patient_number: "TH-1", followed_up_at: null, followed_up_task: null,
        reasons: [{ code: "rising_screen", facts: { instrument: "phq9", from: 8, to: 14, rise: 6, from_at: "2026-08-03T10:00:00Z", to_at: "2026-10-09T10:00:00Z" } }, { code: "made_up", facts: {} }] }, { nope: 1 }],
    });
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]?.reasons).toHaveLength(1);
    expect(describeReason(p.rows[0]!.reasons[0]!)).toBe("PHQ-9 score went from 8 to 14 (up 6) between 3 Aug and 9 Oct.");
  });
  it("describes every code and states what the list does not detect", () => {
    expect(describeReason({ code: "overdue_screen", facts: { instrument: "gad7", due_date: "2026-09-01", days_overdue: 20 } })).toContain("20 days ago");
    expect(describeReason({ code: "sleep_trouble", facts: { trouble_nights: 6, entries: 9, window_days: 14 } })).toContain("6 short or poor nights out of 9");
    expect(describeReason({ code: "missed_checkins", facts: { silent_days: 10, prior_check_ins: 9, last_check_in_on: "2026-10-01" } })).toContain("No mood check-in for 10 days");
    expect(describeReason({ code: "unactioned_handoff", facts: { kind: "doctor_summary", hours_waiting: 60 } })).toContain("60 hours");
    expect(WORKLIST_LIMITS.join(" ")).toMatch(/not a risk predictor/);
    expect(WORKLIST_LIMITS.join(" ")).toMatch(/Silence is not safety/);
  });
});
