import { meanOf, type CohortCell, type CountCell, type Did, type DashboardRow, type DmGroup, type HtnGroup } from "./dashboard-report";

/**
 * The stored dashboard figures as a CSV for the founder. It carries exactly what the page shows: aggregates only, a held-back figure written
 * as "withheld" (never a blank and never a zero), and a plain internal / association-not-proof note on every file. Cells that could be read
 * as a spreadsheet formula are neutralised. Nobody is listed: there is no person, no id and no row-level figure anywhere in a report.
 */
function cell(v: string | number | boolean | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (...cols: (string | number | boolean | null | undefined)[]) => cols.map(cell).join(",");

function count(month: string, item: string, c: CountCell): string[] {
  if (c.suppressed) return [line(month, "engagement", item, "status", "withheld"), line(month, "engagement", item, "reason", c.reason ?? "")];
  return [line(month, "engagement", item, "count", c.count), line(month, "engagement", item, "people", c.people)];
}

function cohort(month: string, section: string, name: string, c: CohortCell): string[] {
  if (c.suppressed) return [line(month, section, name, "status", "withheld"), line(month, section, name, "reason", c.reason ?? "")];
  return [
    line(month, section, name, "people", c.n),
    line(month, section, name, "controlled", c.controlled),
    line(month, section, name, "not_controlled", c.uncontrolled),
    line(month, section, name, "no_or_too_few_readings", c.insufficient_data),
    line(month, section, name, "controlled_pct_of_everyone_due", c.rate_strict_pct),
    line(month, section, name, "controlled_pct_of_those_measured", c.rate_among_measured_pct ?? "withheld"),
    line(month, section, name, "missing_pct", c.missing_pct),
  ];
}

function did(month: string, name: string, d: Did): string[] {
  if (!d.available) return [line(month, "comparison", name, "difference", "not enough data yet")];
  return [
    line(month, "comparison", name, "difference", d.difference),
    line(month, "comparison", name, "interval_low", d.low),
    line(month, "comparison", name, "interval_high", d.high),
    line(month, "comparison", name, "interval_includes_zero", d.interval_includes_zero),
  ];
}

function htnGroup(month: string, name: string, g: HtnGroup): string[] {
  if (g.suppressed) return [line(month, "comparison", `${name}/${g.group}`, "status", "withheld"), line(month, "comparison", `${name}/${g.group}`, "reason", g.reason ?? "")];
  const k = `${name}/${g.group}`;
  return [
    line(month, "comparison", k, "people_measured_at_both_ends", g.people_measured_at_both_ends),
    line(month, "comparison", k, "controlled_before_pct", g.controlled_before_pct),
    line(month, "comparison", k, "controlled_after_pct", g.controlled_after_pct),
    line(month, "comparison", k, "mean_systolic_change", g.systolic_change.mean ?? "withheld"),
    line(month, "comparison", k, "not_measured_at_both_ends_pct", g.not_measured_at_both_ends_pct ?? "withheld"),
  ];
}
function dmGroup(month: string, name: string, g: DmGroup): string[] {
  const k = `${name}/${g.group}`;
  if (g.suppressed) return [line(month, "comparison", k, "status", "withheld"), line(month, "comparison", k, "reason", g.reason ?? "")];
  return [line(month, "comparison", k, "people_with_hba1c_change", g.people_with_hba1c_change), line(month, "comparison", k, "mean_hba1c_change", g.hba1c_change.mean ?? "withheld"), line(month, "comparison", k, "not_measured_pct", g.not_measured_pct ?? "withheld")];
}

export function dashboardToCsv(rows: DashboardRow[]): string {
  const out: string[] = [line("month", "section", "item", "measure", "value")];
  const sorted = [...rows].sort((a, b) => a.period_start.localeCompare(b.period_start));
  for (const r of sorted) {
    const m = r.period_start.slice(0, 7);
    const e = r.report.panels.engagement;
    const o = r.report.panels.outcomes;
    const c = r.report.panels.comparison;
    out.push(line(m, "report", "record", "baseline", r.is_baseline), line(m, "report", "record", "held_back", r.held_back), line(m, "report", "record", "outcome_figures_cut_at", r.data_cutoff),
      line(m, "report", "record", "rules_version", r.config_version), line(m, "report", "record", "generated_at", r.generated_at));
    out.push(...count(m, "active_people", e.active_people));
    if (e.active_logging_days.suppressed) out.push(line(m, "engagement", "active_logging_days", "status", "withheld"));
    else out.push(line(m, "engagement", "active_logging_days", "person_days", e.active_logging_days.person_days), line(m, "engagement", "active_logging_days", "mean_per_active_person", e.active_logging_days.mean_per_active_person));
    out.push(...count(m, "lessons_completed", e.lessons_completed), ...count(m, "medicine_checkins_answered", e.medicine_checkins_answered), ...count(m, "screenings_done", e.screenings_done), ...count(m, "milestones", e.milestones));
    if (e.points_issued.suppressed) out.push(line(m, "engagement", "points_issued", "status", "withheld"));
    else out.push(line(m, "engagement", "points_issued", "points", e.points_issued.points), line(m, "engagement", "points_issued", "earners", e.points_issued.earners));
    for (const k of e.by_cohort) {
      if (k.suppressed) out.push(line(m, "engagement", `joined_${k.cohort}`, "status", "withheld"));
      else out.push(line(m, "engagement", `joined_${k.cohort}`, "active_people", k.active_people), line(m, "engagement", `joined_${k.cohort}`, "mean_active_days", k.mean_active_days), line(m, "engagement", `joined_${k.cohort}`, "points_issued", k.points_issued));
    }
    for (const b of o.hypertension) {
      out.push(...cohort(m, "outcomes", `hypertension_bp_day_${b.day}`, b.due));
      if (b.before) out.push(...cohort(m, "outcomes", `hypertension_bp_first_week_for_day_${b.day}`, b.before));
      if (b.systolic_change) out.push(line(m, "outcomes", `hypertension_bp_day_${b.day}`, "mean_systolic_change", meanOf(b.systolic_change) ?? "withheld"));
    }
    for (const b of o.diabetes) {
      out.push(line(m, "outcomes", `diabetes_hba1c_day_${b.day}`, "mean_change", meanOf(b.hba1c_change) ?? "withheld"));
      out.push(line(m, "outcomes", `diabetes_hba1c_day_${b.day}`, "not_measured_pct", b.not_measured_pct ?? "withheld"));
      out.push(line(m, "outcomes", `diabetes_hba1c_day_${b.day}`, "reached_goal_pct", b.hba1c_goal.suppressed ? "withheld" : b.hba1c_goal.reached_pct));
    }
    if (o.time_to_first_review.suppressed) out.push(line(m, "outcomes", "time_to_first_review", "status", "withheld"));
    else out.push(line(m, "outcomes", "time_to_first_review", "results", o.time_to_first_review.results), line(m, "outcomes", "time_to_first_review", "reviewed", o.time_to_first_review.reviewed),
      line(m, "outcomes", "time_to_first_review", "median_hours", o.time_to_first_review.median_hours ?? "none yet"), line(m, "outcomes", "time_to_first_review", "p90_hours", o.time_to_first_review.p90_hours ?? "none yet"));
    for (const x of o.escalations) out.push(line(m, "outcomes", `escalations_${x.status}`, "people", x.suppressed ? "withheld" : x.people));
    for (const by of ["engagement", "points"] as const) {
      for (const g of c.cohorts.hypertension[by].groups) out.push(...htnGroup(m, `hypertension_by_${by}`, g));
      out.push(...did(m, `hypertension_by_${by}_control_difference_in_differences`, c.cohorts.hypertension[by].difference_in_differences.control));
      out.push(...did(m, `hypertension_by_${by}_systolic_difference_in_differences`, c.cohorts.hypertension[by].difference_in_differences.systolic));
      out.push(...did(m, `hypertension_by_${by}_control_worst_case_difference_in_differences`, c.cohorts.hypertension[by].difference_in_differences.control_strict));
      for (const g of c.cohorts.diabetes[by].groups) out.push(...dmGroup(m, `diabetes_by_${by}`, g));
      out.push(...did(m, `diabetes_by_${by}_hba1c_difference_in_differences`, c.cohorts.diabetes[by].difference_in_differences.hba1c));
    }
    out.push(line(m, "comparison", "design", "minimum_per_group", c.minimum_per_group), line(m, "comparison", "design", "pre_period", c.pre_period),
      line(m, "comparison", "design", "blood_pressure_readings_counted_as_engagement", !c.engagement_excludes_blood_pressure_readings));
  }
  out.push(line("", "notes", "audience", "internal", "founder, super admin and Chief Medical Officer only; not for employers, sponsors, insurers or HMOs"));
  out.push(line("", "notes", "use", "not_publishable", "an association between taking part and outcomes; not evidence that Health Points or taking part change health"));
  out.push(line("", "notes", "held_back", "meaning", "a figure for too few people, or withheld so a smaller group beside it cannot be worked out by subtraction; written as withheld, never as zero"));
  return out.join("\r\n") + "\r\n";
}
