import { getProposedConfig } from "@tarragon/shared";
import {
  buildPreVisitBrief,
  NO_SENSITIVE_ACCESS,
  ok,
  unavailable,
  sensitiveCategoryOf,
  sensitiveCategoriesOf,
  sourceAnchor,
  lagosDate,
  type BriefInput,
  type BriefRules,
  type BriefVitalsRow,
} from "./brief";

const rules = getProposedConfig<BriefRules & Record<string, never>>("copilot.previsit_brief_rules").value as unknown as BriefRules;
const NOW = new Date("2026-10-27T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

/** Both reading types from one list (the brief picks BP and glucose rows by their own fields). */
const vit = (rows: BriefVitalsRow[]) => ({ bloodPressure: ok(rows), glucose: ok(rows) });
const FULL = { reproductive_health: true, mental_health: true, sensitive_positive: true };

const empty: BriefInput = {
  now: NOW,
  bloodPressure: ok([]),
  glucose: ok([]),
  medications: ok([]),
  tasks: ok([]),
  careGaps: ok([]),
  carePlans: ok([]),
  consultations: ok([]),
};
const build = (over: Partial<BriefInput>) => buildPreVisitBrief({ ...empty, ...over }, rules);
const get = (lines: ReturnType<typeof build>, key: string) => lines.find((l) => l.key === key)!;

const bp = (id: string, d: number, s: number, di: number) => ({ id, taken_at: day(d), systolic: s, diastolic: di, glucose_mmol_l: null });

describe("pre-visit brief: trends", () => {
  it("describes a BP trend with n, the window and the first/latest/mean values, and links every reading", () => {
    const lines = build({ ...vit([bp("v1", 20, 150, 95), bp("v2", 10, 140, 90), bp("v3", 2, 130, 85)]) });
    const l = get(lines, "bp_trend");
    expect(l.status).toBe("ok");
    expect(l.text).toContain("3 readings in the last 30 days");
    expect(l.text).toContain("First 150/95");
    expect(l.text).toContain("latest 130/85");
    expect(l.text).toContain("mean 140/90");
    expect(l.sources.map((s) => s.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("says 'not enough in the record' below the minimum, never a guess", () => {
    const l = get(build({ ...vit([bp("v1", 3, 180, 110), bp("v2", 2, 175, 105)]) }), "bp_trend");
    expect(l.status).toBe("not_enough");
    expect(l.text).toContain("Not enough in the record");
    expect(l.text).not.toMatch(/mean|latest/);
  });

  it("ignores readings outside the window", () => {
    const l = get(build({ ...vit([bp("v1", 90, 150, 95), bp("v2", 80, 150, 95), bp("v3", 70, 150, 95)]) }), "bp_trend");
    expect(l.status).toBe("not_enough");
  });

  it("describes glucose separately from BP", () => {
    const g = (id: string, d: number, v: number) => ({ id, taken_at: day(d), systolic: null, diastolic: null, glucose_mmol_l: v });
    const lines = build({ ...vit([g("g1", 9, 8), g("g2", 5, 10), g("g3", 1, 6)]) });
    expect(get(lines, "glucose_trend").text).toContain("mean 8 mmol/L");
    expect(get(lines, "bp_trend").status).toBe("not_enough");
  });

  it("a refused read is 'not available to you', never 'no readings'", () => {
    const l = get(build({ bloodPressure: unavailable(), glucose: unavailable() }), "bp_trend");
    expect(l.status).toBe("unavailable");
    expect(l.text).toContain("Not available to you");
    expect(l.sources).toEqual([]);
  });
});

describe("pre-visit brief: adherence, tasks, gaps, plan, consultation", () => {
  it("flags a refill past due and a missed task, each with its source", () => {
    const l = get(
      build({
        medications: ok([{ id: "m1", drug_name: "Amlodipine", refill_date: day(5).slice(0, 10), updated_at: day(40) }]),
        tasks: ok([{ id: "t1", title: "Log BP", status: "missed", due_at: day(3) }]),
      }),
      "adherence_gaps",
    );
    expect(l.text).toBe("1 refill past due and 1 missed task.");
    expect(l.sources.map((s) => `${s.kind}:${s.id}`)).toEqual(["medication:m1", "care_task:t1"]);
  });

  it("no medicines and no tasks is 'not enough', not 'no gaps'", () => {
    expect(get(build({}), "adherence_gaps").status).toBe("not_enough");
  });

  it("counts open tasks and past-due ones; completed tasks are excluded", () => {
    const l = get(
      build({
        tasks: ok([
          { id: "t1", title: "A", status: "scheduled", due_at: day(-3) },
          { id: "t2", title: "B", status: "in_progress", due_at: day(2) },
          { id: "t3", title: "C", status: "completed", due_at: day(9) },
        ]),
      }),
      "open_tasks",
    );
    expect(l.text).toBe("2 open tasks, 1 past due.");
    expect(l.sources.map((s) => s.id)).toEqual(["t2", "t1"]);
  });

  it("separates abnormal results awaiting action from other care gaps and keys the gap view rows", () => {
    const lines = build({
      careGaps: ok([
        { gap_type: "unactioned_abnormal", condition_or_type: "HbA1c", opened_at: day(4) },
        { gap_type: "overdue_screening", condition_or_type: "Foot exam", opened_at: day(30) },
      ]),
    });
    expect(get(lines, "abnormal_awaiting").text).toBe("1 abnormal result awaiting action.");
    expect(get(lines, "abnormal_awaiting").sources[0]?.id).toContain("unactioned_abnormal:HbA1c");
    expect(get(lines, "care_gaps").text).toBe("1 open care gap.");
  });

  it("reports the most recent plan or medicine change and the last completed consultation", () => {
    const lines = build({
      carePlans: ok([{ id: "p1", condition: "hypertension", updated_at: day(12) }]),
      medications: ok([{ id: "m1", drug_name: "Amlodipine", refill_date: null, updated_at: day(30) }]),
      consultations: ok([
        { id: "c1", status: "completed", scheduled_at: day(60), ended_at: day(60), context: "annual_review" },
        { id: "c2", status: "cancelled", scheduled_at: day(5), ended_at: null, context: "annual_review" },
      ]),
    });
    expect(get(lines, "last_plan_change").sources[0]?.id).toBe("p1");
    expect(get(lines, "last_consultation").sources[0]?.id).toBe("c1");
  });

  it("missing plan and consultation read 'not enough in the record'", () => {
    const lines = build({});
    expect(get(lines, "last_plan_change").text).toContain("Not enough in the record");
    expect(get(lines, "last_consultation").text).toContain("Not enough in the record");
  });
});

describe("pre-visit brief: sensitive categories (INV-10, INV-12)", () => {
  const sensitive = {
    careGaps: ok([
      { gap_type: "overdue_screening", condition_or_type: "Antenatal visit", opened_at: day(5) },
      { gap_type: "overdue_screening", condition_or_type: "PHQ-9 follow-up", opened_at: day(5) },
      { gap_type: "overdue_screening", condition_or_type: "HIV retest", opened_at: day(5) },
      { gap_type: "overdue_screening", condition_or_type: "Eye exam", opened_at: day(5) },
    ]),
    tasks: ok([{ id: "t1", title: "Pregnancy test follow up", status: "scheduled", due_at: day(-2) }]),
  };

  it("drops reproductive, mental-health and sensitive-positive rows by default and never reveals how many", () => {
    const lines = build(sensitive);
    const gaps = get(lines, "care_gaps");
    expect(gaps.text).toBe("1 open care gap.");
    expect(JSON.stringify(lines)).not.toMatch(/antenatal|phq|hiv|pregnan/i);
    expect(JSON.stringify(lines)).not.toMatch(/hidden|withheld|restricted/i);
    expect(get(lines, "open_tasks").text).toBe("No open tasks in the record.");
  });

  it("shows a category only when access for exactly that category is confirmed", () => {
    const lines = build({ ...sensitive, access: { ...NO_SENSITIVE_ACCESS, mental_health: true } });
    expect(get(lines, "care_gaps").text).toBe("2 open care gaps.");
    expect(JSON.stringify(lines)).toMatch(/PHQ-9/);
    expect(JSON.stringify(lines)).not.toMatch(/antenatal|hiv/i);
  });

  it("sabotage: with access forced on, the reproductive row appears, so the default-deny is what hides it", () => {
    const lines = build({ ...sensitive, access: { reproductive_health: true, mental_health: true, sensitive_positive: true } });
    expect(get(lines, "care_gaps").text).toBe("4 open care gaps.");
    expect(JSON.stringify(lines)).toMatch(/Antenatal/);
  });

  it("classifies by the config's term list", () => {
    expect(sensitiveCategoryOf("Contraceptive review", rules.sensitiveTerms)).toBe("reproductive_health");
    expect(sensitiveCategoryOf("Statin review", rules.sensitiveTerms)).toBeNull();
  });
});

describe("pre-visit brief: honesty and source links", () => {
  it("every ok line that cites the record has at least one source with an anchor id", () => {
    const lines = build({ ...vit([bp("v1", 20, 150, 95), bp("v2", 10, 140, 90), bp("v3", 2, 130, 85)]), tasks: ok([{ id: "t1", title: "A", status: "scheduled", due_at: null }]) });
    for (const l of lines.filter((x) => x.status === "ok" && /\d/.test(x.text) && !/^No |^None/.test(x.text))) {
      expect(l.sources.length).toBeGreaterThan(0);
      expect(sourceAnchor(l.sources[0]!)).toMatch(/^source-/);
    }
  });

  it("is deterministic: the same input gives the same lines", () => {
    const input = { ...vit([bp("v1", 20, 150, 95), bp("v2", 10, 140, 90), bp("v3", 2, 130, 85)]) };
    expect(build(input)).toEqual(build(input));
  });

  it("the brief is behind a flag that defaults OFF while the rules are unsigned", () => {
    expect(getProposedConfig("copilot.previsit_brief_enabled").value).toBe(false);
    expect(getProposedConfig("copilot.previsit_brief_enabled").status).toBe("proposed");
  });

  it("the config is unsigned (proposed)", () => {
    expect(getProposedConfig("copilot.previsit_brief_rules").status).toBe("proposed");
  });
});

describe("pre-visit brief: whole-word classification and structured codes (S89 review item 2)", () => {
  it("matches whole words only: 'archive' is not 'hiv', 'bicycle' is not a cycle, 'status' is not an STI", () => {
    for (const text of ["Archive of old notes", "Bicycle accident follow up", "Statin review", "Thiv clinic"]) {
      expect(sensitiveCategoriesOf(text, rules.sensitiveTerms)).toEqual([]);
    }
  });

  it("understands drug names and synonyms, not only the category word", () => {
    const cat = (t: string) => sensitiveCategoryOf(t, rules.sensitiveTerms);
    expect(cat("Tenofovir / lamivudine / dolutegravir")).toBe("sensitive_positive");
    expect(cat("Efavirenz 600 mg")).toBe("sensitive_positive");
    expect(cat("Microgynon 30")).toBe("reproductive_health");
    expect(cat("IVF cycle 2")).toBe("reproductive_health");
    expect(cat("Gestational diabetes screen")).toBe("reproductive_health");
    expect(cat("Perinatal review")).toBe("reproductive_health");
    expect(cat("Sertraline 50 mg")).toBe("mental_health");
    expect(cat("Bipolar disorder")).toBe("mental_health");
    expect(cat("Olanzapine")).toBe("mental_health");
    expect(cat("Syphilis serology")).toBe("sensitive_positive");
    expect(cat("STI screen")).toBe("sensitive_positive");
    expect(cat("PHQ-9 follow-up")).toBe("mental_health");
    expect(cat("Pregnant, 12 weeks")).toBe("reproductive_health");
  });

  it("a row touching two categories needs access to both", () => {
    const meds = ok([{ id: "m1", drug_name: "Sertraline and Microgynon", refill_date: null, updated_at: day(3) }]);
    const one = build({ medications: meds, access: { ...NO_SENSITIVE_ACCESS, mental_health: true } });
    expect(get(one, "last_plan_change").sources).toEqual([]);
    const both = build({ medications: meds, access: { ...NO_SENSITIVE_ACCESS, mental_health: true, reproductive_health: true } });
    expect(get(both, "last_plan_change").sources[0]?.id).toBe("m1");
  });

  it("medicines: a known non-sensitive name is shown; an unlisted one is unknown and hidden without full access", () => {
    const meds = ok([
      { id: "m1", drug_name: "Amlodipine", refill_date: null, updated_at: day(20) },
      { id: "m2", drug_name: "Zorbex", refill_date: null, updated_at: day(1) },
    ]);
    const l = get(build({ medications: meds }), "last_plan_change");
    expect(l.sources[0]?.id).toBe("m1");
    expect(JSON.stringify(build({ medications: meds }))).not.toMatch(/zorbex/i);
    // sabotage: full access shows the unknown medicine, so the fail-closed default is what hid it
    expect(get(build({ medications: meds, access: FULL }), "last_plan_change").sources[0]?.id).toBe("m2");
  });

  it("medicines: a structured care-plan condition counts as a positive non-sensitive classification", () => {
    const meds = ok([{ id: "m1", drug_name: "Zorbex", refill_date: null, updated_at: day(1), care_plan_condition: "hypertension" }]);
    expect(get(build({ medications: meds }), "last_plan_change").sources[0]?.id).toBe("m1");
  });

  it("medicines: a sensitive name wins over a non-sensitive structured code", () => {
    const meds = ok([{ id: "m1", drug_name: "Microgynon", refill_date: null, updated_at: day(1), care_plan_condition: "hypertension" }]);
    expect(get(build({ medications: meds }), "last_plan_change").sources).toEqual([]);
  });

  it("medicines: a sensitive indication hides the row even when the name is listed as non-sensitive", () => {
    const meds = ok([{ id: "m1", drug_name: "Metformin", indication: "PCOS", refill_date: null, updated_at: day(1) }]);
    expect(get(build({ medications: meds }), "last_plan_change").sources).toEqual([]);
  });

  it("care plans: a known condition code is shown; 'other' is unknown and hidden without full access", () => {
    const plans = ok([
      { id: "p1", condition: "hypertension", updated_at: day(10) },
      { id: "p2", condition: "other", updated_at: day(1) },
    ]);
    expect(get(build({ carePlans: plans }), "last_plan_change").sources[0]?.id).toBe("p1");
    expect(get(build({ carePlans: plans, access: FULL }), "last_plan_change").sources[0]?.id).toBe("p2");
  });

  it("consultations: the category filter applies; a specialist consult is unknown and hidden, and older visible ones are labelled as 'among the records shown'", () => {
    const consults = ok([
      { id: "c1", status: "completed", scheduled_at: day(60), ended_at: day(60), context: "general_checkin" },
      { id: "c2", status: "completed", scheduled_at: day(5), ended_at: day(5), context: "specialist_consult" },
    ]);
    const l = get(build({ consultations: consults }), "last_consultation");
    expect(l.sources[0]?.id).toBe("c1");
    expect(l.text).toContain("most recent among the records shown to you");
    expect(JSON.stringify(build({ consultations: consults }))).not.toContain("c2");
    const full = get(build({ consultations: consults, access: FULL }), "last_consultation");
    expect(full.sources[0]?.id).toBe("c2");
    expect(full.text).not.toContain("shown to you");
  });

  it("vitals lines show only the numbers: a reading's free-text note never reaches the line or its source", () => {
    const row = { ...bp("v1", 3, 150, 95), note: "after HIV clinic visit" } as BriefVitalsRow & { note: string };
    const lines = build({ ...vit([row, bp("v2", 2, 140, 90), bp("v3", 1, 130, 85)]) });
    expect(JSON.stringify(lines)).not.toMatch(/hiv/i);
  });
});

describe("pre-visit brief: reading windows and cut-off fetches (S89 review item 3)", () => {
  it("fetching by type means other readings can no longer crowd BP out: 3 BP among many weights still trends", () => {
    const l = get(build({ bloodPressure: ok([bp("v1", 9, 150, 95), bp("v2", 5, 140, 90), bp("v3", 1, 130, 85)]), glucose: ok([]) }), "bp_trend");
    expect(l.status).toBe("ok");
  });

  it("when a type returns as many rows as the limit, it says 'showing latest N; older readings not included' and gives no total count", () => {
    const small: BriefRules = { ...rules, maxReadingsRead: 3 };
    const rows = [bp("v1", 9, 150, 95), bp("v2", 5, 140, 90), bp("v3", 1, 130, 85)];
    const l = get(buildPreVisitBrief({ ...empty, bloodPressure: ok(rows) }, small), "bp_trend");
    expect(l.status).toBe("ok");
    expect(l.text).toContain("Showing the latest 3 readings");
    expect(l.text).toContain("older readings are not included");
    expect(l.text).not.toMatch(/^3 readings/);
    // sabotage: one row fewer than the limit is not a cut-off, and says nothing of the kind
    const under = get(buildPreVisitBrief({ ...empty, bloodPressure: ok(rows.slice(0, 2)) }, small), "bp_trend");
    expect(under.text).not.toContain("older readings");
  });

  it("the limit comes from the config (maxReadingsRead), and is wide enough for a month of twice-daily readings", () => {
    expect(rules.maxReadingsRead).toBeGreaterThanOrEqual(60);
  });

  it("glucose is cut off the same way", () => {
    const small: BriefRules = { ...rules, maxReadingsRead: 3 };
    const g = (id: string, d: number, v: number) => ({ id, taken_at: day(d), systolic: null, diastolic: null, glucose_mmol_l: v });
    const l = get(buildPreVisitBrief({ ...empty, glucose: ok([g("g1", 9, 8), g("g2", 5, 10), g("g3", 1, 6)]) }, small), "glucose_trend");
    expect(l.text).toContain("older readings are not included");
  });

  it("one type refused does not turn the other into 'none'", () => {
    const lines = build({ bloodPressure: unavailable(), glucose: ok([]) });
    expect(get(lines, "bp_trend").status).toBe("unavailable");
    expect(get(lines, "glucose_trend").status).toBe("not_enough");
  });
});

describe("pre-visit brief: unknown is not none (S89 review item 4)", () => {
  const med = (id: string, refill: string | null) => ({ id, drug_name: "Amlodipine", refill_date: refill, updated_at: day(40) });

  it("tasks refused: never 'no missed tasks'; the line is unknown and says Not available", () => {
    const l = get(build({ medications: ok([med("m1", day(-20).slice(0, 10))]), tasks: unavailable() }), "adherence_gaps");
    expect(l.status).toBe("unknown");
    expect(l.text).toContain("Missed tasks: Not available to you.");
    expect(l.text).not.toMatch(/No overdue refills or missed tasks/);
  });

  it("a null refill date is unknown, not 'nothing overdue'", () => {
    const l = get(build({ medications: ok([med("m1", null)]) }), "adherence_gaps");
    expect(l.status).toBe("unknown");
    expect(l.text).toContain("No refill date is recorded for 1 medicine");
    expect(l.text).not.toMatch(/No overdue refills/);
  });

  it("an overdue refill is still reported when another medicine has no date or tasks are refused", () => {
    const l = get(build({ medications: ok([med("m1", day(5).slice(0, 10)), med("m2", null)]), tasks: unavailable() }), "adherence_gaps");
    expect(l.status).toBe("unknown");
    expect(l.text).toContain("1 refill past due.");
    expect(l.sources.map((s) => s.id)).toEqual(["m1"]);
  });

  it("medicines refused but tasks readable: the missed task still shows and refills are 'Not available'", () => {
    const l = get(build({ medications: unavailable(), tasks: ok([{ id: "t1", title: "Log BP", status: "missed", due_at: day(2) }]) }), "adherence_gaps");
    expect(l.text).toContain("1 missed task.");
    expect(l.text).toContain("Refills: Not available to you.");
    expect(l.status).toBe("unknown");
  });

  it("both refused is plain 'Not available'", () => {
    expect(get(build({ medications: unavailable(), tasks: unavailable() }), "adherence_gaps").status).toBe("unavailable");
  });

  it("everything known and nothing overdue is still the reassuring 'ok' line (sabotage: the unknown cases above are what differ)", () => {
    const l = get(build({ medications: ok([med("m1", day(-20).slice(0, 10))]), tasks: ok([]) }), "adherence_gaps");
    expect(l).toMatchObject({ status: "ok", text: "No overdue refills or missed tasks in the record." });
  });
});

describe("pre-visit brief: refill dates are Africa/Lagos calendar days (S89 review item 9)", () => {
  const med = (refill: string) => ({ id: "m1", drug_name: "Amlodipine", refill_date: refill, updated_at: day(40) });
  const adherence = (now: string, refill: string) =>
    get(buildPreVisitBrief({ ...empty, now: new Date(now), medications: ok([med(refill)]) }, rules), "adherence_gaps");

  it("formats the Lagos date", () => {
    expect(lagosDate(new Date("2026-10-26T23:30:00Z"))).toBe("2026-10-27");
  });

  it("due today is not overdue, even just after UTC midnight (the old UTC comparison called it overdue)", () => {
    // 00:30 UTC on the 27th is 01:30 in Lagos on the 27th
    expect(adherence("2026-10-27T00:30:00Z", "2026-10-27").text).toBe("No overdue refills or missed tasks in the record.");
  });

  it("due today is not overdue late in the Lagos day either", () => {
    expect(adherence("2026-10-27T22:30:00Z", "2026-10-27").status).toBe("ok");
    expect(adherence("2026-10-27T22:30:00Z", "2026-10-27").text).toContain("No overdue");
  });

  it("flips to overdue at Lagos midnight, not UTC midnight: 23:30 UTC on the 27th is already the 28th in Lagos", () => {
    expect(adherence("2026-10-27T23:30:00Z", "2026-10-27").text).toBe("1 refill past due.");
    // sabotage: an hour earlier it is still the 27th in Lagos and not overdue
    expect(adherence("2026-10-27T22:59:00Z", "2026-10-27").text).toContain("No overdue");
  });

  it("yesterday is overdue", () => {
    expect(adherence("2026-10-27T10:00:00Z", "2026-10-26").text).toBe("1 refill past due.");
  });

  it("refillOverdueDays is a grace in calendar days", () => {
    const grace: BriefRules = { ...rules, refillOverdueDays: 3 };
    const run = (refill: string) => get(buildPreVisitBrief({ ...empty, medications: ok([med(refill)]) }, grace), "adherence_gaps").text;
    expect(run("2026-10-24")).toContain("No overdue");
    expect(run("2026-10-23")).toBe("1 refill past due.");
  });
});
