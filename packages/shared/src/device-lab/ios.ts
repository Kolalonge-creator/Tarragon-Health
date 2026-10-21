import { bytesToMb, type DeviceLabBudgets } from "./budgets";
import type { Exec } from "./android";
import { METRIC_IDS, METRIC_ORDER } from "./metrics";
import { parseDuKb, parsePsRssKb, parseSimctlLaunchPid } from "./parse";
import { measured, notMeasured, redactId, type AppInfo, type DeviceInfo, type MetricResult } from "./report";
import { median } from "./stats";

/**
 * iOS: a booted SIMULATOR only. A simulator runs on the host Mac's CPU, memory and disk, so none of these numbers says anything about an iPhone and
 * every verdict is NOT EVALUATED. The point of running it is to prove the harness works end to end and to size the bundle. A real iPhone is measured
 * by hand with Xcode (RUNBOOK) and entered with --manual.
 */
export interface IosOptions {
  readonly udid: string;
  readonly simulatorName: string;
  readonly bundleId: string;
  readonly appPath: string | null;
  readonly buildLabel: string | null;
  readonly coldRuns: number;
  readonly settleMs: number;
  readonly sleep: (ms: number) => void;
}

const L = {
  coldStart: "Cold launch wall time (simulator, includes simctl overhead)",
  size: "Installed size (app bundle on the simulator)",
  memory: "Memory (resident set of the app process, simulator)",
  logWrite: "Log a reading: store write",
  logVisible: "Log a reading: saved notice visible",
  reconnect: "Reconnect flush after the network returns",
  probe: "Reachability probe cost with one row waiting",
} as const;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function collectIos(exec: Exec, opts: IosOptions, budgets: DeviceLabBudgets) {
  const notes: string[] = ["Simulator run: every verdict is NOT EVALUATED. Measure a real iPhone by hand (RUNBOOK) and pass the numbers with --manual."];
  const simctl = (args: readonly string[], timeoutMs = 60_000) => {
    const r = exec("xcrun", ["simctl", ...args], { timeoutMs });
    if (!r.ok) throw new Error(`simctl ${args[0] ?? ""} failed: ${r.stderr.trim().split("\n")[0] ?? "no output"}`);
    return r;
  };
  const ctx = { realDevice: false, buildKind: "unknown" as const, buildSensitive: true };
  const metrics: MetricResult[] = [];
  const miss = (id: string, label: string, unit: string, budget: number | null, why: string): void => {
    metrics.push(notMeasured(id, label, unit, budget, why));
  };

  if (opts.appPath) {
    try {
      simctl(["install", opts.udid, opts.appPath], 180_000);
      notes.push("Installed the given .app on the simulator before measuring.");
    } catch (e) {
      notes.push(`Install failed, measuring whatever was already installed: ${errText(e)}`);
    }
  }

  // Cold launch.
  let pid: number | null = null;
  try {
    const samples: number[] = [];
    for (let i = 0; i < opts.coldRuns; i += 1) {
      exec("xcrun", ["simctl", "terminate", opts.udid, opts.bundleId], { timeoutMs: 30_000 }); // fails harmlessly when not running
      opts.sleep(opts.settleMs);
      const r = simctl(["launch", opts.udid, opts.bundleId], 60_000);
      pid = parseSimctlLaunchPid(r.stdout);
      samples.push(r.elapsedMs);
    }
    metrics.push(measured({
      id: METRIC_IDS.coldStart, label: L.coldStart, unit: "ms", source: "simctl", value: median(samples), samples,
      budget: budgets.coldStartMsMax, context: ctx,
      notes: ["Wall time of `simctl launch`, which returns when the process starts, not when a screen is drawn."],
    }));
  } catch (e) {
    miss(METRIC_IDS.coldStart, L.coldStart, "ms", budgets.coldStartMsMax, errText(e));
  }

  // Size.
  try {
    const container = simctl(["get_app_container", opts.udid, opts.bundleId, "app"]).stdout.trim();
    if (!container) throw new Error("no app container path");
    const du = exec("du", ["-sk", container], { timeoutMs: 60_000 });
    if (!du.ok) throw new Error("du failed");
    metrics.push(measured({
      id: METRIC_IDS.size, label: L.size, unit: "MB", source: "simctl", value: bytesToMb(parseDuKb(du.stdout) * 1024),
      budget: budgets.installedSizeMbMax, context: ctx,
      notes: ["Debug simulator bundle, uncompressed, no App Thinning: not comparable to a store download or an on-device install size."],
    }));
  } catch (e) {
    miss(METRIC_IDS.size, L.size, "MB", budgets.installedSizeMbMax, errText(e));
  }

  // Memory.
  try {
    if (pid === null) throw new Error("the app was not launched, so there is no process to read");
    const ps = exec("ps", ["-o", "rss=", "-p", String(pid)], { timeoutMs: 15_000 });
    if (!ps.ok) throw new Error("ps could not read the app process");
    metrics.push(measured({
      id: METRIC_IDS.memory, label: L.memory, unit: "MB", source: "simctl", value: bytesToMb(parsePsRssKb(ps.stdout) * 1024),
      budget: budgets.memoryMbMax, context: ctx,
      notes: ["Read right after launch, not after the offline-logging flow."],
    }));
  } catch (e) {
    miss(METRIC_IDS.memory, L.memory, "MB", budgets.memoryMbMax, errText(e));
  }

  const manualOnly = "needs a person on a real iPhone (RUNBOOK); Maestro airplane mode is Android only";
  miss(METRIC_IDS.coldStartUsable, "Cold start to first usable screen (timed by hand)", "ms", budgets.coldStartMsMax, manualOnly);
  miss(METRIC_IDS.sizeSettings, "Installed size as Settings shows it (read by hand)", "MB", budgets.installedSizeMbMax, manualOnly);
  miss(METRIC_IDS.logWrite, L.logWrite, "ms", budgets.logStoreWriteMsMax, manualOnly);
  miss(METRIC_IDS.logVisible, L.logVisible, "ms", budgets.logVisibleMsMax, manualOnly);
  miss(METRIC_IDS.reconnect, L.reconnect, "s", budgets.reconnectFlushSecondsMax, manualOnly);
  miss(METRIC_IDS.probe, L.probe, "requests/min", budgets.probeRequestsPerMinuteMax, manualOnly);

  const sorted = METRIC_ORDER.map((id) => metrics.find((m) => m.id === id) as MetricResult);
  const device: DeviceInfo = {
    platform: "ios", realDevice: false, id: redactId(opts.udid), manufacturer: "Apple", model: `Simulator ${opts.simulatorName}`,
    osVersion: null, sdk: null, ramMb: null,
  };
  const app: AppInfo = { packageId: opts.bundleId, versionName: null, versionCode: null, buildKind: "unknown", buildLabel: opts.buildLabel };
  return { device, app, metrics: sorted, notes };
}
