import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { engagementSeries, isShown, meanOf, parseDashboard, pct, pctOfShare, points, signed, withheldKey } from "./dashboard-report";
import { dashboardToCsv } from "./dashboard-csv";

// Both fixtures are the real output of read_outcomes_dashboard from the migration, run against a scratch database: one where every group is large
// enough to show, one where a group is small, a neighbour is withheld with it, and a cohort has a small category. If the SQL shape changes, parsing
// them fails here before the page does.
const load = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
const rich = parseDashboard(load("dashboard-rich.json"));
const sparse = parseDashboard(load("dashboard-sparse.json"));

describe("parseDashboard", () => {
  it("accepts the database output in both a full and a sparse report", () => {
    expect(rich).not.toBeNull();
    expect(sparse).not.toBeNull();
    expect(rich?.[0]?.publishable).toBe(false);
    expect(rich?.[0]?.report.internal_only).toBe(true);
    expect(rich?.[0]?.report.not_a_causal_claim).toBe(true);
  });

  it("has exactly the three panels and no combined score anywhere", () => {
    const panels = rich?.[0]?.report.panels ?? {};
    expect(Object.keys(panels).sort()).toEqual(["comparison", "engagement", "outcomes"]);
    expect(JSON.stringify(rich)).not.toMatch(/"[a-z_]*(score|composite|blend|impact)[a-z_]*":/i);
  });

  it("refuses a report marked publishable, one not marked internal, or any shape it does not know", () => {
    const row = JSON.parse(JSON.stringify(load("dashboard-rich.json"))) as { publishable: boolean; report: { internal_only: boolean } }[];
    row[0]!.publishable = true;
    expect(parseDashboard(row)).toBeNull();
    const row2 = JSON.parse(JSON.stringify(load("dashboard-rich.json"))) as { publishable: boolean; report: { internal_only: boolean } }[];
    row2[0]!.report.internal_only = false;
    expect(parseDashboard(row2)).toBeNull();
    expect(parseDashboard({})).toBeNull();
    expect(parseDashboard([{ id: "x" }])).toBeNull();
    expect(parseDashboard(null)).toBeNull();
  });

  it("carries no person identifier in either fixture", () => {
    for (const f of ["dashboard-rich.json", "dashboard-sparse.json"]) {
      expect(JSON.stringify(load(f))).not.toMatch(/patient_id|subject_key|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*"patient/i);
    }
  });
});

describe("a full report", () => {
  const p = rich![0]!.report.panels;
  it("shows the blood pressure control cohort with its Wilson interval and its first-week figure", () => {
    const b = p.outcomes.hypertension[0]!;
    expect(isShown(b.due)).toBe(true);
    if (isShown(b.due)) expect(b.due.n).toBe(120);
    expect(b.strict_rate_interval?.low).toBeLessThan(b.strict_rate_interval?.high ?? 0);
    expect(b.before && isShown(b.before)).toBe(true);
  });

  it("gives an estimate with an interval that brackets it, for both ways of drawing the groups", () => {
    for (const by of ["engagement", "points"] as const) {
      const d = p.comparison.cohorts.hypertension[by].difference_in_differences;
      expect(d.control.available).toBe(true);
      if (d.control.available) {
        expect(d.control.low).toBeLessThan(d.control.difference);
        expect(d.control.difference).toBeLessThan(d.control.high);
      }
      expect(d.systolic.available).toBe(true);
    }
  });

  it("says that the pre-period is the same people's first week and that blood pressure logging is not engagement", () => {
    expect(p.comparison.pre_period).toBe("day_0_same_people");
    expect(p.comparison.engagement_excludes_blood_pressure_readings).toBe(true);
  });

  it("lists what is not measured instead of inventing it", () => {
    expect(p.outcomes.not_measured).toEqual(["medicine_refill_completion", "glucose_time_in_range"]);
  });
});

describe("a sparse report", () => {
  const p = sparse![0]!.report.panels;
  it("withholds a cohort that has one small category, with no counts inside", () => {
    const due = p.outcomes.hypertension[0]!.due;
    expect(isShown(due)).toBe(false);
    expect(JSON.stringify(due)).not.toMatch(/"controlled"|"uncontrolled"|rate_strict_pct/);
  });

  it("withholds the small group and takes its neighbour with it, and then gives no estimate", () => {
    const e = p.comparison.cohorts.hypertension.engagement;
    const byName = Object.fromEntries(e.groups.map((g) => [g.group, g]));
    expect(byName.middle?.suppressed).toBe(true);
    expect(byName.high?.suppressed).toBe(true);
    expect(withheldKey(byName.high as { reason?: string })).toBe("outcomes.dash.withheld_neighbour");
    expect(byName.low?.suppressed).toBe(false);
    expect(e.difference_in_differences.control.available).toBe(false);
    expect(e.difference_in_differences.systolic.available).toBe(false);
  });
});

describe("helpers", () => {
  it("formats without ever turning a missing figure into a zero", () => {
    expect(pct(46)).toBe("46.0%");
    expect(pct(null)).toBe("-");
    expect(pctOfShare(0.3656)).toBe("36.6%");
    expect(signed(-13.09, 1)).toBe("-13.1");
    expect(signed(0.44, 2)).toBe("+0.44");
    expect(points(0.3)).toBe("+30.0");
    expect(points(undefined)).toBe("-");
    expect(meanOf({ suppressed: true, reason: "x" })).toBeNull();
    expect(meanOf({ n: 1 })).toBeNull();
    expect(meanOf({ n: 10, mean: -2.5 })).toBe(-2.5);
  });

  it("builds the month series with a held-back month as a gap and not a zero", () => {
    const rows = JSON.parse(JSON.stringify(load("dashboard-rich.json"))) as unknown[];
    const clone = JSON.parse(JSON.stringify(rows[0])) as { period_start: string; id: string; report: { panels: { engagement: { active_people: unknown; points_issued: unknown } } } };
    clone.period_start = "2026-07-01";
    clone.id = "other";
    clone.report.panels.engagement.active_people = { suppressed: true, reason: "under_minimum", minimum: 20 };
    clone.report.panels.engagement.points_issued = { suppressed: true, reason: "under_minimum", minimum: 20 };
    const parsed = parseDashboard([rows[0], clone]);
    const series = engagementSeries(parsed!);
    expect(series.map((s) => s.month)).toEqual(["2026-07", "2026-08"]);
    expect(series[0]).toEqual({ month: "2026-07", people: null, points: null });
    expect(series[1]?.people).toBeGreaterThan(0);
  });
});

describe("the CSV", () => {
  const csv = dashboardToCsv(sparse!);
  it("writes a held-back figure as withheld and never as a blank or a zero", () => {
    expect(csv).toMatch(/hypertension_bp_day_90,status,withheld/);
    expect(csv).toMatch(/hypertension_by_engagement\/middle,status,withheld/);
    expect(csv).toMatch(/not enough data yet/);
  });
  it("is aggregate only: no id, no person, and an internal and association note on the file", () => {
    expect(csv).not.toMatch(/patient|subject|[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(csv).toMatch(/internal,"founder, super admin and Chief Medical Officer only/);
    expect(csv).toMatch(/not_publishable,an association/);
  });
  it("has one header and a consistent five columns per row", () => {
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("month,section,item,measure,value");
    for (const r of rows) expect(r.match(/(?:"[^"]*"|[^,])+|(?<=,)(?=,)|^(?=,)|(?<=,)$/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
  it("neutralises a cell that could run as a formula", () => {
    const rows = JSON.parse(JSON.stringify(load("dashboard-rich.json"))) as { id: string }[];
    expect(rows[0]).toBeDefined();
    const csv2 = dashboardToCsv(parseDashboard(rows)!);
    expect(csv2).not.toMatch(/(^|,)[=+@]/m);
  });
  it("lists a rich report in full (every group shown)", () => {
    const full = dashboardToCsv(rich!);
    expect(full).toMatch(/hypertension_by_engagement\/high,people_measured_at_both_ends,40/);
    expect(full).toMatch(/hypertension_by_engagement_control_difference_in_differences,difference,/);
  });
});
