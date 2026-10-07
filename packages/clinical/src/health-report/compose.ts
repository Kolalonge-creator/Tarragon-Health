import type {
  ComposedReport,
  HealthReportConfig,
  HealthReportFacts,
  LabPoint,
  ReportChange,
  ReportItem,
  ReportPriority,
} from "./types";

/**
 * The yearly report composer (S46, 3.15). Pure and deterministic: facts in, a report out. No model is involved (INV-01 spirit) and nothing here
 * invents a clinical range. The honesty rules from docs/research/health-report-study.md are enforced here and again by the database guard
 * private.health_report_assert_honest:
 *   - no "on target" without a recorded value inside the target window;
 *   - a blood pressure summary below the minimum reading count says "too few readings to judge", it never passes or fails;
 *   - at most three priorities (config.maxPriorities, itself capped at three here); the rest go to "also worth knowing";
 *   - borderline is shown as borderline with a recheck interval and is never "on target";
 *   - compare to the patient's own previous year only, never to other people, and never convert a unit.
 */

const HARD_PRIORITY_CAP = 3;

function item(partial: Partial<ReportItem> & Pick<ReportItem, "id" | "kind" | "code" | "state">): ReportItem {
  return {
    value: null,
    value2: null,
    unit: null,
    readingCount: 0,
    tooFewReadings: false,
    minReadings: null,
    borderline: false,
    recheckWeeks: null,
    target: null,
    change: "no_comparison",
    previousValue: null,
    dateFrom: null,
    dateTo: null,
    reason: null,
    excess: 0,
    ...partial,
  };
}

/** Percent outside a lab reference range (0 when inside or no range). */
function labExcessPct(p: LabPoint): number {
  if (p.refHigh !== null && p.value > p.refHigh && p.refHigh !== 0) return ((p.value - p.refHigh) / Math.abs(p.refHigh)) * 100;
  if (p.refLow !== null && p.value < p.refLow && p.refLow !== 0) return ((p.refLow - p.value) / Math.abs(p.refLow)) * 100;
  return 0;
}

function hasRange(p: LabPoint): boolean {
  return p.refLow !== null || p.refHigh !== null;
}

function composeBp(f: HealthReportFacts, cfg: HealthReportConfig): ReportItem {
  const { bp } = f;
  const base = { id: "bp", kind: "bp" as const, code: "blood_pressure", unit: "mmHg", minReadings: cfg.minBpReadings, dateFrom: bp.firstAt, dateTo: bp.lastAt };
  if (bp.count === 0 || bp.avgSystolic === null || bp.avgDiastolic === null) {
    return item({ ...base, state: "not_measured", reason: "no_readings", readingCount: 0 });
  }
  if (bp.count < cfg.minBpReadings) {
    return item({ ...base, state: "not_measured", reason: "too_few_readings", tooFewReadings: true, readingCount: bp.count });
  }
  const careTeam = f.bpCareTeamTarget;
  const sysT = careTeam?.systolicBelow ?? cfg.bpTarget.systolicBelow;
  const diaT = careTeam?.diastolicBelow ?? cfg.bpTarget.diastolicBelow;
  const source = careTeam ? ("care_team" as const) : ("report_settings" as const);
  const excessNow = Math.max(bp.avgSystolic - sysT, bp.avgDiastolic - diaT);
  const above = excessNow >= 0;
  const borderlineAbove = above && excessNow <= cfg.bpBorderlineMarginMmHg;

  let change: ReportChange = "no_comparison";
  let previousValue: number | null = null;
  if (f.bpPrior && f.bpPrior.count >= cfg.minBpReadings && f.bpPrior.avgSystolic !== null && f.bpPrior.avgDiastolic !== null) {
    previousValue = f.bpPrior.avgSystolic;
    const excessPrev = Math.max(f.bpPrior.avgSystolic - sysT, f.bpPrior.avgDiastolic - diaT);
    const tolerance = (cfg.changeTolerancePct / 100) * sysT;
    const delta = excessNow - excessPrev;
    change = Math.abs(delta) <= tolerance ? "same" : delta < 0 ? "improved" : "worse";
  }

  return item({
    ...base,
    state: above ? "needs_attention" : "on_target",
    value: bp.avgSystolic,
    value2: bp.avgDiastolic,
    readingCount: bp.count,
    borderline: borderlineAbove,
    recheckWeeks: borderlineAbove ? cfg.recheckWeeks : null,
    target: { low: null, high: sysT, high2: diaT, source },
    change,
    previousValue,
    excess: Math.max(0, excessNow),
  });
}

function composeLab(l: HealthReportFacts["labs"][number], cfg: HealthReportConfig): ReportItem | null {
  const p = l.latest;
  if (!p) return null;
  const base = { id: `lab:${l.code}`, kind: "lab" as const, code: l.code, unit: p.unit ?? l.unit, readingCount: l.readingsThisYear, dateFrom: p.at, dateTo: p.at, value: p.value };
  const target = hasRange(p) ? { low: p.refLow, high: p.refHigh, high2: null, source: "lab_reference" as const } : null;

  let change: ReportChange = "no_comparison";
  let previousValue: number | null = null;
  const prev = l.previous;
  if (prev && (prev.unit ?? null) === (p.unit ?? null) && hasRange(p)) {
    // different ranges between years (a different lab) are fine: each value is judged against its own lab's range
    previousValue = prev.value;
    const exNow = labExcessPct(p);
    const exPrev = hasRange(prev) ? labExcessPct(prev) : null;
    if (exPrev === null) change = "no_comparison";
    else if (Math.abs(exNow - exPrev) <= cfg.changeTolerancePct) change = "same";
    else change = exNow < exPrev ? "improved" : "worse";
  }

  if (!target) return item({ ...base, state: "no_target", change: "no_comparison", previousValue, reason: "no_range_from_lab" });

  const abnormalFlag = p.flag !== null && ["high", "low", "critical"].includes(p.flag);
  const excess = labExcessPct(p);
  if (excess === 0 && !abnormalFlag) {
    return item({ ...base, state: "on_target", target, change, previousValue });
  }
  // outside the lab's own range, or the lab flagged it: needs attention; a small excess is borderline with a recheck interval, never pass or fail
  const borderline = excess > 0 && excess <= cfg.labBorderlineMarginPct && p.flag !== "critical";
  return item({
    ...base,
    state: "needs_attention",
    target,
    change,
    previousValue,
    borderline,
    recheckWeeks: borderline ? cfg.recheckWeeks : null,
    excess: Math.max(excess, abnormalFlag ? 0.01 : 0),
  });
}

function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - new Date(a).getTime()) / 86_400_000);
}

export function composeHealthReport(facts: HealthReportFacts, config: HealthReportConfig, today: Date = new Date()): ComposedReport {
  const cap = Math.min(config.maxPriorities, HARD_PRIORITY_CAP);
  const items: ReportItem[] = [];
  items.push(composeBp(facts, config));
  for (const l of facts.labs) {
    const it = composeLab(l, config);
    if (it) items.push(it);
  }
  // overdue screening is "not checked": nothing is claimed about the result
  const overdue = facts.screening.due.filter((d) => d.status === "overdue" || new Date(d.dueOn) < today);
  for (const d of overdue) {
    items.push(item({ id: `screening:${d.code}`, kind: "screening", code: d.code, state: "not_checked", dateTo: d.dueOn, reason: "overdue" }));
  }

  const win = config.priorityWindows;
  const candidates: { rank: number; sort: number; p: ReportPriority }[] = [];
  const bp = items.find((i) => i.id === "bp");
  if (bp) {
    if (bp.state === "needs_attention" && !bp.borderline) {
      candidates.push({ rank: 10, sort: -bp.excess, p: { id: "bp", category: "bp", action: "report.priority.bp.action", why: "report.priority.bp.why", whoHelps: "report.who.care_team", when: win.bp, params: { count: bp.readingCount } } });
    } else if (bp.state === "needs_attention") {
      candidates.push({ rank: 50, sort: 0, p: { id: "bp", category: "bp", action: "report.priority.bp_borderline.action", why: "report.priority.bp_borderline.why", whoHelps: "report.who.you_and_care_team", when: win.bp, params: { weeks: config.recheckWeeks } } });
    } else if (bp.state === "not_measured") {
      candidates.push({ rank: 60, sort: 0, p: { id: "bp", category: "bp", action: "report.priority.bp_more_readings.action", why: "report.priority.bp_more_readings.why", whoHelps: "report.who.you", when: win.bp, params: { min: config.minBpReadings, count: bp.readingCount } } });
    }
  }
  if (facts.risk.state === "assessed" && (facts.risk.tier === "high" || facts.risk.tier === "very_high")) {
    candidates.push({ rank: 20, sort: 0, p: { id: "risk", category: "risk", action: "report.priority.risk.action", why: "report.priority.risk.why", whoHelps: "report.who.care_team", when: win.risk, params: {} } });
  }
  for (const i of items.filter((x) => x.kind === "lab" && x.state === "needs_attention")) {
    candidates.push({
      rank: i.borderline ? 55 : 30,
      sort: -i.excess,
      p: { id: i.id, category: "lab", action: i.borderline ? "report.priority.lab_borderline.action" : "report.priority.lab.action", why: "report.priority.lab.why", whoHelps: "report.who.care_team", when: win.lab, params: { code: i.code, weeks: config.recheckWeeks } },
    });
  }
  for (const d of overdue) {
    candidates.push({ rank: 40, sort: -daysBetween(d.dueOn, today), p: { id: `screening:${d.code}`, category: "screening", action: "report.priority.screening.action", why: "report.priority.screening.why", whoHelps: "report.who.you_and_care_team", when: win.screening, params: { code: d.code } } });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.sort - b.sort || a.p.id.localeCompare(b.p.id));
  const priorities = candidates.slice(0, cap).map((c) => c.p);
  const alsoWorthKnowing = candidates.slice(cap).map((c) => c.p);

  const onTarget = items.filter((i) => i.state === "on_target").length;
  const needs = items.filter((i) => i.state === "needs_attention").length;
  const notMeasured = items.filter((i) => i.state === "not_measured" || i.state === "not_checked").length;
  const summary: ComposedReport["summary"] =
    onTarget + needs === 0
      ? { key: "report.summary.nothing_measured", params: { notMeasured } }
      : { key: "report.summary.default", params: { onTarget, needsAttention: needs, notMeasured } };

  return {
    schema: 1,
    year: facts.year,
    items,
    priorities,
    alsoWorthKnowing,
    summary,
    risk: facts.risk,
    screening: facts.screening,
    trends: facts.trends.filter((t) => t.points.length >= config.trendMinPoints),
    questionnaires: facts.questionnaires,
    devices: facts.devices,
    weight: facts.weight,
    statementKey: config.statementKey,
    statementApprovedByCmo: config.statementApprovedByCmo,
    minBpReadings: config.minBpReadings,
  };
}

/**
 * A copy for sharing (principle 12, consent-led sharing): the sections the settings list are dropped by default. Reproductive screening, the risk
 * band and questionnaire results are excluded unless the patient explicitly includes them.
 */
export function shareableView(report: ComposedReport, config: HealthReportConfig, include: readonly string[] = []): ComposedReport {
  const drop = (s: string) => config.shareExcludedSections.includes(s) && !include.includes(s);
  const keep = (p: ReportPriority): boolean =>
    !(drop("risk") && p.category === "risk") &&
    !(drop("screening_reproductive") && p.category === "screening" && isReproductiveCode(p.id.replace("screening:", ""), report));
  return {
    ...report,
    risk: drop("risk") ? { state: "not_assessed" } : report.risk,
    questionnaires: drop("questionnaires") ? [] : report.questionnaires,
    screening: drop("screening_reproductive")
      ? { done: report.screening.done.filter((d) => !d.reproductive), due: report.screening.due.filter((d) => !d.reproductive) }
      : report.screening,
    priorities: report.priorities.filter(keep),
    alsoWorthKnowing: report.alsoWorthKnowing.filter(keep),
    items: drop("screening_reproductive") ? report.items.filter((i) => !(i.kind === "screening" && isReproductiveCode(i.code, report))) : report.items,
  };
}

function isReproductiveCode(code: string, report: ComposedReport): boolean {
  return [...report.screening.done, ...report.screening.due].some((s) => s.code === code && s.reproductive);
}
