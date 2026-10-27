import { getProposedConfig } from "@tarragon/shared";
import { buildPreVisitBrief, NO_SENSITIVE_ACCESS, ok, unavailable, sensitiveCategoryOf, sourceAnchor, type BriefInput, type BriefRules } from "./brief";

const rules = getProposedConfig<BriefRules & Record<string, never>>("copilot.previsit_brief_rules").value as unknown as BriefRules;
const NOW = new Date("2026-10-27T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const empty: BriefInput = {
  now: NOW,
  vitals: ok([]),
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
    const lines = build({ vitals: ok([bp("v1", 20, 150, 95), bp("v2", 10, 140, 90), bp("v3", 2, 130, 85)]) });
    const l = get(lines, "bp_trend");
    expect(l.status).toBe("ok");
    expect(l.text).toContain("3 readings in the last 30 days");
    expect(l.text).toContain("First 150/95");
    expect(l.text).toContain("latest 130/85");
    expect(l.text).toContain("mean 140/90");
    expect(l.sources.map((s) => s.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("says 'not enough in the record' below the minimum, never a guess", () => {
    const l = get(build({ vitals: ok([bp("v1", 3, 180, 110), bp("v2", 2, 175, 105)]) }), "bp_trend");
    expect(l.status).toBe("not_enough");
    expect(l.text).toContain("Not enough in the record");
    expect(l.text).not.toMatch(/mean|latest/);
  });

  it("ignores readings outside the window", () => {
    const l = get(build({ vitals: ok([bp("v1", 90, 150, 95), bp("v2", 80, 150, 95), bp("v3", 70, 150, 95)]) }), "bp_trend");
    expect(l.status).toBe("not_enough");
  });

  it("describes glucose separately from BP", () => {
    const g = (id: string, d: number, v: number) => ({ id, taken_at: day(d), systolic: null, diastolic: null, glucose_mmol_l: v });
    const lines = build({ vitals: ok([g("g1", 9, 8), g("g2", 5, 10), g("g3", 1, 6)]) });
    expect(get(lines, "glucose_trend").text).toContain("mean 8 mmol/L");
    expect(get(lines, "bp_trend").status).toBe("not_enough");
  });

  it("a refused read is 'not available to you', never 'no readings'", () => {
    const l = get(build({ vitals: unavailable() }), "bp_trend");
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
        { gap_type: "overdue_screening", condition_or_type: "Cervical", opened_at: day(30) },
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
        { id: "c1", status: "completed", scheduled_at: day(60), ended_at: day(60) },
        { id: "c2", status: "cancelled", scheduled_at: day(5), ended_at: null },
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
    const lines = build({ vitals: ok([bp("v1", 20, 150, 95), bp("v2", 10, 140, 90), bp("v3", 2, 130, 85)]), tasks: ok([{ id: "t1", title: "A", status: "scheduled", due_at: null }]) });
    for (const l of lines.filter((x) => x.status === "ok" && /\d/.test(x.text) && !/^No |^None/.test(x.text))) {
      expect(l.sources.length).toBeGreaterThan(0);
      expect(sourceAnchor(l.sources[0]!)).toMatch(/^source-/);
    }
  });

  it("is deterministic: the same input gives the same lines", () => {
    const input = { vitals: ok([bp("v1", 20, 150, 95), bp("v2", 10, 140, 90), bp("v3", 2, 130, 85)]) };
    expect(build(input)).toEqual(build(input));
  });

  it("the config is unsigned (proposed)", () => {
    expect(getProposedConfig("copilot.previsit_brief_rules").status).toBe("proposed");
  });
});
