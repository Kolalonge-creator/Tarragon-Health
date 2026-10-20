import type { DeviceLabBudgets } from "./budgets";
import type { BuildKind } from "./parse";
import { summarise, type Summary } from "./stats";

/**
 * The device lab report. Two rules are enforced in code, not left to the caller:
 *  1. A metric that was not measured carries no number and no PASS or FAIL (verdict "N/A").
 *  2. A number only gets PASS or FAIL when it was measured on a real device with a release build. A simulator, a debug
 *     build or an unknown build kind gives NOT EVALUATED or INCONCLUSIVE, never PASS.
 * The report never states an overall pass.
 */

export type MetricStatus = "measured" | "not measured";
export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE" | "NO BUDGET" | "NOT EVALUATED" | "N/A";
export type MetricSource = "adb" | "simctl" | "maestro" | "manual";

export interface MetricResult {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly status: MetricStatus;
  readonly source: MetricSource | null;
  readonly value: number | null;
  readonly samples: readonly number[];
  readonly summary: Summary | null;
  readonly budget: number | null;
  readonly verdict: Verdict;
  /** Why the metric is not measured, or why it has no PASS or FAIL. */
  readonly reason: string | null;
  readonly notes: readonly string[];
}

export interface EvalContext {
  /** false for a simulator or emulator. */
  readonly realDevice: boolean;
  readonly buildKind: BuildKind;
  /** Whether build kind matters for this metric. Every collector sets it true today (a debug build also slows logging and the flush), so an unknown or debug build never yields PASS or FAIL for any metric. */
  readonly buildSensitive: boolean;
}

export interface MeasuredInput {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly source: MetricSource;
  readonly value: number;
  readonly samples?: readonly number[];
  readonly budget: number | null;
  readonly context: EvalContext;
  /** Default "exact". Use "lower" when the value can only understate the budgeted quantity. */
  readonly bound?: Bound;
  readonly notes?: readonly string[];
  /** For metrics whose verdict needs more than value <= budget (the reconnect flush). Only honoured when measured. */
  readonly verdictOverride?: { readonly verdict: Verdict; readonly reason: string | null };
}

/**
 * "exact": the value is the thing the budget is about. "lower": the value can only UNDERSTATE the budgeted quantity (time to first frame
 * understates time to a usable screen; APK bytes understate installed size), so being over budget is a proven FAIL but being under it proves nothing.
 */
export type Bound = "exact" | "lower";

export function verdictFor(value: number, budget: number | null, ctx: EvalContext, bound: Bound = "exact"): { verdict: Verdict; reason: string | null } {
  if (!ctx.realDevice) return { verdict: "NOT EVALUATED", reason: "measured on a simulator or emulator, which says nothing about a real phone" };
  if (ctx.buildSensitive && ctx.buildKind === "debug") {
    return { verdict: "NOT EVALUATED", reason: "the installed build is debuggable (a development build); budgets apply to the release build only" };
  }
  if (ctx.buildSensitive && ctx.buildKind === "unknown") {
    return { verdict: "INCONCLUSIVE", reason: "could not tell whether the installed build is a release build" };
  }
  if (budget === null) return { verdict: "NO BUDGET", reason: "no budget is set for this metric; the number is recorded only" };
  if (bound === "lower") {
    return value > budget
      ? { verdict: "FAIL", reason: "even this lower bound is over budget, so the real figure is too" }
      : { verdict: "INCONCLUSIVE", reason: "this is only a lower bound on the budgeted quantity, so being under budget proves nothing; time or read the real figure by hand and enter it with --manual" };
  }
  return { verdict: value <= budget ? "PASS" : "FAIL", reason: null };
}

export function measured(input: MeasuredInput): MetricResult {
  if (!Number.isFinite(input.value)) throw new Error(`${input.id}: a measured value must be finite`);
  const samples = input.samples ?? [input.value];
  // An override may refine PASS or FAIL, but only where the environment already allows a PASS or FAIL (real device, release build, budget set).
  const gate = verdictFor(input.value, input.budget, input.context, input.bound ?? "exact");
  const base = input.verdictOverride && (gate.verdict === "PASS" || gate.verdict === "FAIL")
    ? { verdict: input.verdictOverride.verdict, reason: input.verdictOverride.reason }
    : gate;
  return {
    id: input.id,
    label: input.label,
    unit: input.unit,
    status: "measured",
    source: input.source,
    value: input.value,
    samples,
    summary: samples.length > 1 ? summarise(samples) : null,
    budget: input.budget,
    verdict: base.verdict,
    reason: base.reason,
    notes: input.notes ?? [],
  };
}

export function notMeasured(
  id: string,
  label: string,
  unit: string,
  budget: number | null,
  reason: string,
): MetricResult {
  if (!reason.trim()) throw new Error(`${id}: a metric that was not measured needs a reason`);
  return {
    id,
    label,
    unit,
    status: "not measured",
    source: null,
    value: null,
    samples: [],
    summary: null,
    budget,
    verdict: "N/A",
    reason,
    notes: [],
  };
}

export interface DeviceInfo {
  readonly platform: "android" | "ios";
  readonly realDevice: boolean;
  readonly id: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly osVersion: string | null;
  readonly sdk: string | null;
  readonly ramMb: number | null;
}

export interface AppInfo {
  readonly packageId: string;
  readonly versionName: string | null;
  readonly versionCode: number | null;
  readonly buildKind: BuildKind;
  readonly buildLabel: string | null;
}

export interface DeviceLabReport {
  readonly schema: 1;
  readonly generatedAt: string;
  readonly mode: "REPORT ONLY";
  readonly gitSha: string | null;
  readonly budgets: DeviceLabBudgets;
  readonly device: DeviceInfo;
  readonly app: AppInfo;
  readonly metrics: readonly MetricResult[];
  readonly measuredCount: number;
  readonly totalCount: number;
  readonly completeness: "COMPLETE" | "INCOMPLETE";
  readonly notes: readonly string[];
}

/** Throws when a metric breaks the two rules above. Called by buildReport so a bad report cannot be written. */
export function assertConsistent(metrics: readonly MetricResult[]): void {
  for (const m of metrics) {
    if (m.status === "not measured") {
      if (m.value !== null || m.samples.length > 0 || m.verdict !== "N/A" || m.source !== null) {
        throw new Error(`${m.id}: not measured but carries a value, samples, a source or a verdict`);
      }
      if (!m.reason) throw new Error(`${m.id}: not measured without a reason`);
    } else {
      if (m.value === null || !Number.isFinite(m.value) || m.source === null) {
        throw new Error(`${m.id}: measured without a finite value or a source`);
      }
      if (m.verdict === "N/A") throw new Error(`${m.id}: measured but verdict N/A`);
    }
  }
}

export function buildReport(args: {
  readonly generatedAt: string;
  readonly gitSha: string | null;
  readonly budgets: DeviceLabBudgets;
  readonly device: DeviceInfo;
  readonly app: AppInfo;
  readonly metrics: readonly MetricResult[];
  readonly notes: readonly string[];
}): DeviceLabReport {
  assertConsistent(args.metrics);
  if (!args.device.realDevice) {
    for (const m of args.metrics) {
      if (m.verdict === "PASS" || m.verdict === "FAIL") {
        throw new Error(`${m.id}: a simulator report must not carry ${m.verdict}`);
      }
    }
  }
  const measuredCount = args.metrics.filter((m) => m.status === "measured").length;
  return {
    schema: 1,
    generatedAt: args.generatedAt,
    mode: "REPORT ONLY",
    gitSha: args.gitSha,
    budgets: args.budgets,
    device: args.device,
    app: args.app,
    metrics: args.metrics,
    measuredCount,
    totalCount: args.metrics.length,
    completeness: measuredCount === args.metrics.length ? "COMPLETE" : "INCOMPLETE",
    notes: args.notes,
  };
}

/** Keep only the tail of a device serial or UDID: this report is committed to a public repository. */
export function redactId(id: string): string {
  return id.length <= 4 ? id : `...${id.slice(-4)}`;
}

export function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "unknown-device";
}

/** `<date>-<device>` without extension, for docs/device-lab/. */
export function reportBaseName(date: string, device: DeviceInfo): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`bad date ${date}`);
  const name = [device.manufacturer, device.model].filter(Boolean).join(" ") || device.id;
  return `${date}-${slug(name)}`;
}

function fmt(value: number | null, unit: string): string {
  if (value === null) return "not measured";
  if (unit === "ms" || unit === "kB") return `${Math.round(value)} ${unit}`;
  return `${(Math.round(value * 10) / 10).toString()} ${unit}`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

export function renderMarkdown(r: DeviceLabReport): string {
  const out: string[] = [];
  const d = r.device;
  const title = [d.manufacturer, d.model].filter(Boolean).join(" ") || d.id;
  out.push(`# Device lab report: ${title}`);
  out.push("");
  out.push(`**Mode: REPORT ONLY.** Budgets are reported, never used to fail a build or a release. This report states no overall pass.`);
  out.push("");
  out.push(`**${r.measuredCount} of ${r.totalCount} metrics measured (${r.completeness}).** A metric marked \`not measured\` has no number and no verdict.`);
  out.push("");
  out.push("## Device and build");
  out.push("");
  out.push(`- Platform: ${d.platform} (${d.realDevice ? "real device" : "SIMULATOR OR EMULATOR, numbers are not evidence about a phone"})`);
  out.push(`- Device: ${cell(title)} (id \`${d.id}\`)`);
  out.push(`- OS: ${d.osVersion ?? "unknown"}${d.sdk ? ` (SDK ${d.sdk})` : ""}; RAM: ${d.ramMb === null ? "unknown" : `${Math.round(d.ramMb)} MB`}`);
  out.push(`- App: \`${r.app.packageId}\` version ${r.app.versionName ?? "unknown"} (code ${r.app.versionCode ?? "unknown"}), build kind: ${r.app.buildKind}${r.app.buildLabel ? `, label: ${cell(r.app.buildLabel)}` : ""}`);
  out.push(`- Repo commit: ${r.gitSha ?? "unknown"}; run at ${r.generatedAt}`);
  out.push(`- Budgets: \`device_lab.budgets\` v${r.budgets.configVersion} (${r.budgets.configStatus}, from packages/shared/src/proposed-config)`);
  out.push("");
  out.push("## Metrics");
  out.push("");
  out.push("| Metric | Status | Value | Budget | Verdict |");
  out.push("|---|---|---|---|---|");
  for (const m of r.metrics) {
    const value = m.status === "measured" ? fmt(m.value, m.unit) + (m.source ? ` (${m.source})` : "") : "not measured";
    const budget = m.budget === null ? "none" : `${fmt(m.budget, m.unit)} max`;
    out.push(`| ${cell(m.label)} | ${m.status} | ${cell(value)} | ${budget} | ${m.verdict} |`);
  }
  out.push("");
  out.push("## Detail");
  out.push("");
  for (const m of r.metrics) {
    out.push(`### ${m.label}`);
    out.push("");
    out.push(`- Status: ${m.status}; verdict: ${m.verdict}`);
    if (m.reason) out.push(`- ${m.status === "measured" ? "Why no PASS or FAIL" : "Why not measured"}: ${cell(m.reason)}`);
    if (m.summary) {
      const s = m.summary;
      out.push(`- Runs: ${s.n}; min ${fmt(s.min, m.unit)}, median ${fmt(s.median, m.unit)}, p95 ${fmt(s.p95, m.unit)}, max ${fmt(s.max, m.unit)}`);
      out.push(`- Samples: ${m.samples.map((x) => Math.round(x * 10) / 10).join(", ")}`);
    }
    for (const n of m.notes) out.push(`- ${cell(n)}`);
    out.push("");
  }
  if (r.notes.length > 0) {
    out.push("## Notes");
    out.push("");
    for (const n of r.notes) out.push(`- ${cell(n)}`);
    out.push("");
  }
  out.push("## What this report does not show");
  out.push("");
  out.push("- Cold start here is the time to the first drawn frame reported by the platform, not the time to a usable screen. Time the usable screen by hand or screen recording and record it with `--manual`.");
  out.push("- Nothing here is a clinical or safety result. Reminder delivery after a reboot, the lease wipe and the battery-manager checks are in the manual part of docs/device-lab/RUNBOOK.md.");
  out.push("");
  return out.join("\n");
}
