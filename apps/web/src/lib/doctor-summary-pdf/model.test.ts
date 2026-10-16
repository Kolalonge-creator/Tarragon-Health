import {
  BP_SOURCE_LABEL,
  buildBpChart,
  buildBpSection,
  buildSkipped,
  buildSymptoms,
  describeSchedule,
  requestSchema,
  summaryConfig,
  SECTION_KEYS,
  type BpReadingIn,
} from "./model";
import { sampleReadings, SAMPLE_NOW_MS } from "./sample-data";

const cfg = summaryConfig();

const reading = (over: Partial<BpReadingIn>): BpReadingIn => ({
  takenAt: "2026-10-10T08:00:00Z",
  systolic: 130,
  diastolic: 80,
  pulse: null,
  source: "manual",
  validationStatus: "valid",
  ...over,
});

describe("blood pressure section", () => {
  it("averages only cuff, typed and confirmed-photo readings; a wearable reading is listed, labelled and kept out of the average", () => {
    const without = buildBpSection([reading({ systolic: 130 }), reading({ systolic: 140, source: "device", takenAt: "2026-10-11T08:00:00Z" })], cfg);
    const withWearable = buildBpSection(
      [reading({ systolic: 130 }), reading({ systolic: 140, source: "device", takenAt: "2026-10-11T08:00:00Z" }), reading({ systolic: 200, diastolic: 130, source: "wearable", takenAt: "2026-10-12T08:00:00Z" })],
      cfg,
    );
    expect(without.average).toEqual({ systolic: 135, diastolic: 80, count: 2 });
    // sabotage check: if the wearable leaked into the average this would be 157
    expect(withWearable.average).toEqual(without.average);
    expect(withWearable.excludedFromAverage).toBe(1);
    const w = withWearable.lines.find((l) => l.trust === "wearable");
    expect(w).toBeDefined();
    expect(w?.inAverage).toBe(false);
    expect(BP_SOURCE_LABEL.wearable).toMatch(/not in the average/);
  });

  it("keeps wearable readings out of the chart too", () => {
    const s = buildBpSection([reading({}), reading({ systolic: 200, source: "wearable", takenAt: "2026-10-12T08:00:00Z" })], cfg);
    expect(s.chartReadings).toHaveLength(1);
    expect(s.chartReadings[0]?.systolic).toBe(130);
  });

  it("keeps imported and unknown sources out of the average as well", () => {
    const s = buildBpSection([reading({}), reading({ systolic: 210, source: "fhir_import", takenAt: "2026-10-12T08:00:00Z" }), reading({ systolic: 211, source: "cgm", takenAt: "2026-10-13T08:00:00Z" })], cfg);
    expect(s.average?.count).toBe(1);
    expect(s.excludedFromAverage).toBe(2);
  });

  it("does not count a reading that failed validation or has a missing value, and says how many", () => {
    const s = buildBpSection([reading({}), reading({ validationStatus: "rejected" }), reading({ systolic: null })], cfg);
    expect(s.totalListed).toBe(1);
    expect(s.notCounted).toBe(2);
  });

  it("returns no average (not zero) when only wearable readings exist", () => {
    const s = buildBpSection([reading({ source: "wearable" })], cfg);
    expect(s.average).toBeNull();
    expect(s.totalListed).toBe(1);
  });

  it("caps the list at the configured size, newest first, but averages every counted reading", () => {
    const many = Array.from({ length: cfg.maxBpRows + 10 }, (_, i) => reading({ takenAt: new Date(Date.parse("2026-09-01T08:00:00Z") + i * 3600_000).toISOString(), systolic: 100 + i }));
    const s = buildBpSection(many, cfg);
    expect(s.lines).toHaveLength(cfg.maxBpRows);
    expect(s.truncated).toBe(true);
    expect(s.lines[0]?.systolic).toBe(100 + cfg.maxBpRows + 9);
    expect(s.average?.count).toBe(many.length);
  });

  it("runs on the shared sample with its wild wearable value", () => {
    const s = buildBpSection(sampleReadings(), cfg);
    expect(s.average?.systolic).toBeLessThan(150);
    expect(s.notCounted).toBe(1);
  });
});

describe("blood pressure chart", () => {
  it("returns null for no readings and a single centred point for one", () => {
    expect(buildBpChart([])).toBeNull();
    const one = buildBpChart([{ takenAt: "2026-10-10T08:00:00Z", systolic: 130, diastolic: 80 }]);
    expect(one?.systolic).toHaveLength(1);
    expect(one?.xLabels).toHaveLength(1);
  });

  it("puts every point inside the plot area and orders them in time", () => {
    const readings = [
      { takenAt: "2026-10-01T08:00:00Z", systolic: 150, diastolic: 95 },
      { takenAt: "2026-10-08T08:00:00Z", systolic: 120, diastolic: 70 },
      { takenAt: "2026-10-15T08:00:00Z", systolic: 135, diastolic: 85 },
    ];
    const c = buildBpChart(readings);
    if (!c) throw new Error("no chart");
    for (const p of [...c.systolic, ...c.diastolic]) {
      expect(p.x).toBeGreaterThanOrEqual(c.plot.left);
      expect(p.x).toBeLessThanOrEqual(c.plot.right);
      expect(p.y).toBeGreaterThanOrEqual(c.plot.top);
      expect(p.y).toBeLessThanOrEqual(c.plot.bottom);
    }
    expect(c.systolic[0]!.x).toBeLessThan(c.systolic[2]!.x);
    // a higher value sits higher on the page (smaller y)
    expect(c.systolic[0]!.y).toBeLessThan(c.systolic[1]!.y);
    expect(c.yMin).toBeLessThanOrEqual(70);
    expect(c.yMax).toBeGreaterThanOrEqual(150);
  });

  it("draws no target band and no verdict anywhere in its shape", () => {
    const c = buildBpChart([{ takenAt: "2026-10-01T08:00:00Z", systolic: 150, diastolic: 95 }]);
    expect(Object.keys(c ?? {}).sort()).toEqual(["diastolic", "height", "plot", "systolic", "width", "xLabels", "yMax", "yMin", "yTicks"]);
  });
});

describe("request", () => {
  const schema = requestSchema(cfg);
  it("accepts the default period and any valid section, de-duplicated", () => {
    const r = schema.parse({ days: null, sections: ["bp", "bp", "symptoms"] });
    expect(r.days).toBe(cfg.defaultDays);
    expect(r.sections).toEqual(["bp", "symptoms"]);
  });
  it("rejects no sections, an unknown section and a period that is not offered", () => {
    expect(schema.safeParse({ days: "30", sections: [] }).success).toBe(false);
    expect(schema.safeParse({ days: "30", sections: ["bp", "reproductive_health"] }).success).toBe(false);
    expect(schema.safeParse({ days: "365", sections: ["bp"] }).success).toBe(false);
    expect(schema.safeParse({ days: "abc", sections: ["bp"] }).success).toBe(false);
  });
  it("has no section for reproductive or mental health, so neither can be ticked", () => {
    expect(SECTION_KEYS.join(",")).not.toMatch(/reproduct|mental|cycle|pregnan|contracept|fertil/);
  });
});

describe("symptoms", () => {
  it("leaves out whole entries of a reproductive symptom type and counts them separately", () => {
    const since = Date.parse("2026-09-16T00:00:00Z");
    const s = buildSymptoms(
      [
        { reportedAt: "2026-10-14T18:00:00Z", symptomType: "dizziness", freeText: null, severity: 2 },
        { reportedAt: "2026-10-12T18:00:00Z", symptomType: "testicular_pain", freeText: "private note", severity: 5 },
        { reportedAt: "2026-10-11T18:00:00Z", symptomType: "testicular_lump", freeText: null, severity: null },
      ],
      since,
      cfg,
    );
    expect(s.lines.map((l) => l.label)).toEqual(["Dizziness"]);
    expect(JSON.stringify(s.lines)).not.toMatch(/private note/);
    expect(s.leftOut).toBe(2);
  });
  it("drops entries older than the period and sorts newest first", () => {
    const s = buildSymptoms(
      [
        { reportedAt: "2026-10-01T00:00:00Z", symptomType: "fatigue", freeText: null, severity: null },
        { reportedAt: "2026-10-10T00:00:00Z", symptomType: "pain", freeText: null, severity: null },
        { reportedAt: "2026-06-01T00:00:00Z", symptomType: "nausea", freeText: null, severity: null },
      ],
      Date.parse("2026-09-16T00:00:00Z"),
      cfg,
    );
    expect(s.lines.map((l) => l.label)).toEqual(["Pain", "Fatigue"]);
  });
});

describe("skipped doses and schedules", () => {
  it("gives the reason in words and says so when none was given", () => {
    const r = buildSkipped(
      [
        { date: "2026-10-12", time: "20:00", medicine: "Metformin", missedReason: "feels_well", reason: "ate late" },
        { date: "2026-10-04", time: "08:00", medicine: "Amlodipine", missedReason: null, reason: null },
      ],
      cfg,
    );
    expect(r.lines[0]).toEqual({ when: "12 Oct, 20:00", medicine: "Metformin", reason: "felt well, ate late" });
    expect(r.lines[1]?.reason).toBe("no reason given");
  });
  it("describes schedules without changing them", () => {
    expect(describeSchedule({ kind: "daily", times: ["08:00", "20:00"], startDate: null, endDate: null, foodNote: "with_food" }, null)).toBe("every day at 08:00, 20:00, with food");
    expect(describeSchedule({ kind: "weekdays", times: ["07:00"], days: [1, 3], startDate: null, endDate: null, foodNote: null }, null)).toBe("Monday, Wednesday at 07:00");
    expect(describeSchedule({ kind: "as_needed", maxPerDay: 3, startDate: null, endDate: null, foodNote: null }, null)).toBe("only when needed, at most 3 a day");
    expect(describeSchedule(null, "twice daily")).toBe("twice daily");
  });
});

describe("config", () => {
  it("is well formed and lists exactly the average-eligible sources", () => {
    expect(cfg.averageSources).toEqual(["manual", "device", "photo_confirmed"]);
    expect(cfg.averageSources).not.toContain("wearable");
  });
  it("uses a fixed clock for the sample", () => {
    expect(SAMPLE_NOW_MS).toBe(Date.parse("2026-10-16T09:00:00Z"));
  });
});
