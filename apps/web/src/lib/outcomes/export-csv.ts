import { isShown, type BpReport, type Cohort } from "./bp-report";

/**
 * The aggregate pilot report as a CSV file (S38d, Module 22.9). It carries exactly what the report page shows: aggregate figures, small
 * groups withheld, the definition and the limits, and no individual. A withheld figure is written as "withheld", never as a blank or a
 * zero. Cells that could be read as a spreadsheet formula are neutralised.
 */
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const line = (...cols: (string | number | null | undefined)[]) => cols.map(cell).join(",");

function cohortRows(name: string, c: Cohort): string[] {
  if (!isShown(c)) return [line(name, "status", "withheld"), line(name, "reason", c.reason), line(name, "minimum_group_size", c.minimum)];
  return [
    line(name, "people", c.n),
    line(name, "controlled", c.controlled),
    line(name, "not_controlled", c.uncontrolled),
    line(name, "no_or_too_few_readings", c.insufficient_data),
    line(name, "controlled_pct_of_everyone_due", c.rate_strict_pct),
    line(name, "controlled_pct_of_those_measured", c.rate_among_measured_pct ?? "withheld"),
    line(name, "missing_pct", c.missing_pct),
  ];
}

export function reportToCsv(r: BpReport): string {
  const rows: string[] = [line("section", "item", "value")];
  rows.push(line("report", "measure", r.measure), line("report", "rules_version", r.config_version));
  rows.push(line("report", "minimum_group_size", r.minimum_cell), line("report", "range_from", r.range?.from ?? "all"), line("report", "range_to", r.range?.to ?? "all"));
  rows.push(line("report", "generated_at", r.generated_at));
  rows.push(...cohortRows("everyone_day_90_due", r.cohort_all_due), ...cohortRows("started_above_target", r.cohort_baseline_uncontrolled));
  if ("suppressed" in r.change_among_measured) rows.push(line("change_from_day_0", "status", "withheld"));
  else rows.push(line("change_from_day_0", "people_measured_at_both_ends", r.change_among_measured.n), line("change_from_day_0", "mean_systolic_change", r.change_among_measured.mean_systolic_change), line("change_from_day_0", "mean_diastolic_change", r.change_among_measured.mean_diastolic_change));
  if ("suppressed" in r.adherence_separate) rows.push(line("adherence_separate", "status", "withheld"));
  else rows.push(line("adherence_separate", "people", r.adherence_separate.n), line("adherence_separate", "mean_pct", r.adherence_separate.mean_pct));
  if ("suppressed" in r.data_quality) rows.push(line("data_quality", "status", "withheld"));
  else {
    const d = r.data_quality;
    rows.push(line("data_quality", "enrolled_total", d.enrolled_total), line("data_quality", "day_90_not_yet_due", d.not_yet_due), line("data_quality", "baseline_missing_pct", d.baseline_missing_pct),
      line("data_quality", "day_90_no_reading_pct", d.day90_no_reading_pct), line("data_quality", "default_target_used_pct", d.default_target_used_pct),
      line("data_quality", "readings_after_snapshot_pct", d.readings_arriving_after_snapshot_pct));
  }
  if (r.months_withheld === 0) {
    for (const m of r.by_enrolment_month) rows.push(...cohortRows(`month_joined_${m.enrolment_month.slice(0, 7)}`, m));
  } else rows.push(line("by_month_joined", "status", `withheld (${r.months_withheld} month(s) had a group that was too small)`));
  rows.push(line("notes", "definition", r.definition), line("notes", "limitations", r.limitations));
  rows.push(line("notes", "causal_claim", "none: this describes members who logged readings and does not compare with a control group"));
  return rows.join("\r\n") + "\r\n";
}
