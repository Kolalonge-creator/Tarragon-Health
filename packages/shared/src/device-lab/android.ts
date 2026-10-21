import { bytesToMb, type DeviceLabBudgets } from "./budgets";
import {
  parseAirplaneMode,
  parseAmStartW,
  parseDumpsysPackage,
  parseFocusedPackage,
  parseGetprop,
  parseMeminfoTotalPssKb,
  parsePmPath,
  parseProcMemTotalKb,
  parseResolveActivity,
  parseStatSizes,
  uiDumpContains,
  type BuildKind,
} from "./parse";
import { measured, notMeasured, redactId, type AppInfo, type DeviceInfo, type EvalContext, type MetricResult } from "./report";
import { DEFAULT_ANDROID_PACKAGE } from "./constants";
import { budgetFor, MANUAL_IDS, METRIC_IDS, METRIC_ORDER } from "./metrics";
import { median } from "./stats";

export { MANUAL_IDS, METRIC_IDS };

export interface ExecResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

/** Runs a program with an argument list (no shell). Injected so the collector is testable without a device. */
export type Exec = (
  cmd: string,
  args: readonly string[],
  opts?: { readonly timeoutMs?: number; /** Extra environment for the child only (used for the test account, so it never appears in argv). */ readonly env?: Readonly<Record<string, string>> },
) => ExecResult;

export interface AndroidOptions {
  readonly serial: string;
  readonly packageId: string;
  readonly apkPath: string | null;
  readonly buildLabel: string | null;
  /** Directory holding prepare-offline-log.yaml, assert-flushed.yaml and noop.yaml. */
  readonly flowDir: string;
  readonly skipFlows: boolean;
  readonly credentials: { readonly email: string; readonly password: string } | null;
  readonly manual: Readonly<Record<string, number>>;
  readonly coldRuns: number;
  readonly settleMs: number;
  readonly sleep: (ms: number) => void;
}

export interface Collected {
  readonly device: DeviceInfo;
  readonly app: AppInfo;
  readonly metrics: MetricResult[];
  readonly notes: string[];
}

const LABELS = {
  coldStart: "Cold start to first frame (median of runs)",
  coldStartUsable: "Cold start to first usable screen (timed by hand)",
  size: "Installed size, APK files only (lower bound)",
  sizeSettings: "Installed size as Android Settings shows it (read by hand)",
  memory: "Memory after the offline-logging flow (total PSS)",
  logWrite: "Log a reading: store write",
  logVisible: "Log a reading: saved notice visible",
  reconnect: "Reconnect flush after the network returns",
  probe: "Reachability probe cost with one row waiting",
} as const;

const MANUAL_UNITS: Record<string, { unit: string; label: string }> = {
  [METRIC_IDS.logWrite]: { unit: "ms", label: LABELS.logWrite },
  [METRIC_IDS.logVisible]: { unit: "ms", label: LABELS.logVisible },
  [METRIC_IDS.probe]: { unit: "requests/min", label: LABELS.probe },
  [METRIC_IDS.memory]: { unit: "MB", label: LABELS.memory },
  [METRIC_IDS.sizeSettings]: { unit: "MB", label: LABELS.sizeSettings },
  [METRIC_IDS.coldStartUsable]: { unit: "ms", label: LABELS.coldStartUsable },
  [METRIC_IDS.reconnect]: { unit: "s", label: LABELS.reconnect },
};

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function collectAndroid(exec: Exec, opts: AndroidOptions, budgets: DeviceLabBudgets): Collected {
  const notes: string[] = [];
  const adb = (args: readonly string[], timeoutMs = 60_000): ExecResult => {
    const r = exec("adb", ["-s", opts.serial, ...args], { timeoutMs });
    if (!r.ok) throw new Error(`adb ${args[0] ?? ""} failed: ${r.stderr.trim().split("\n")[0] ?? "no output"}`);
    return r;
  };
  const shell = (cmd: string, timeoutMs?: number): ExecResult => adb(["shell", cmd], timeoutMs);

  // Device identity. A failure here is fatal for the whole run: there is no device to report on.
  const props = parseGetprop(shell("getprop").stdout);
  let ramMb: number | null = null;
  try {
    ramMb = parseProcMemTotalKb(shell("cat /proc/meminfo").stdout) / 1024;
  } catch (e) {
    notes.push(`RAM not read: ${errText(e)}`);
  }
  const device: DeviceInfo = {
    platform: "android",
    realDevice: !/^(sdk_|Android SDK|google_sdk|emulator)/i.test(props["ro.product.model"] ?? "") && props["ro.kernel.qemu"] !== "1" && !/ranchu|goldfish/.test(props["ro.hardware"] ?? ""),
    id: redactId(opts.serial),
    manufacturer: props["ro.product.manufacturer"] ?? null,
    model: props["ro.product.model"] ?? null,
    osVersion: props["ro.build.version.release"] ?? null,
    sdk: props["ro.build.version.sdk"] ?? null,
    ramMb,
  };
  if (!device.realDevice) notes.push("This looks like an emulator. Every verdict is NOT EVALUATED.");

  if (opts.apkPath) {
    try {
      const r = exec("adb", ["-s", opts.serial, "install", "-r", opts.apkPath], { timeoutMs: 300_000 });
      if (!r.ok || !/Success/.test(r.stdout)) throw new Error(r.stderr.trim().split("\n")[0] || r.stdout.trim() || "install did not report Success");
      notes.push("Installed the given APK with adb install -r before measuring (data kept).");
    } catch (e) {
      notes.push(`APK install failed, measuring whatever build was already on the phone: ${errText(e)}`);
    }
  }

  // Package identity and build kind.
  let installedPaths: string[] | null = null;
  let buildKind: BuildKind = "unknown";
  let versionName: string | null = null;
  let versionCode: number | null = null;
  try {
    installedPaths = parsePmPath(shell(`pm path ${opts.packageId}`).stdout);
    const info = parseDumpsysPackage(shell(`dumpsys package ${opts.packageId}`, 120_000).stdout);
    buildKind = info.buildKind;
    versionName = info.versionName;
    versionCode = info.versionCode;
    if (buildKind !== "release") notes.push(`Build kind is ${buildKind}: cold start, size, memory and latency get no PASS or FAIL. Use a release (EAS preview or production) build.`);
  } catch (e) {
    notes.push(`Package not readable: ${errText(e)}`);
  }
  const app: AppInfo = { packageId: opts.packageId, versionName, versionCode, buildKind, buildLabel: opts.buildLabel };

  const ctx: EvalContext = { realDevice: device.realDevice, buildKind, buildSensitive: true };
  const results = new Map<string, MetricResult>();
  const record = (m: MetricResult): void => { results.set(m.id, m); };
  const fail = (id: string, label: string, unit: string, reason: string): void => {
    record(notMeasured(id, label, unit, budgetFor(id, budgets), reason));
  };

  // 1. Cold start.
  if (!installedPaths) {
    fail(METRIC_IDS.coldStart, LABELS.coldStart, "ms", "the app is not installed on the phone");
  } else {
    try {
      const component = parseResolveActivity(shell(`cmd package resolve-activity --brief ${opts.packageId}`).stdout, opts.packageId);
      const samples: number[] = [];
      let unreported = 0;
      for (let i = 0; i < opts.coldRuns; i += 1) {
        shell(`am force-stop ${opts.packageId}`);
        opts.sleep(opts.settleMs);
        const r = parseAmStartW(shell(`am start -W -n ${component}`, 90_000).stdout);
        if (r.launchState !== null && r.launchState !== "COLD") throw new Error(`run ${i + 1} was a ${r.launchState} start, not cold`);
        if (r.launchState === null) unreported += 1;
        samples.push(r.totalTimeMs);
      }
      const notesLocal = ["Time to the first drawn frame (am start -W TotalTime). The budget is about a usable screen, which is later, so this is a lower bound: over budget is a FAIL, under budget is INCONCLUSIVE until the usable-screen time is entered by hand."];
      if (unreported > 0) notesLocal.push(`${unreported} run(s) did not report LaunchState (Android before 10); each was preceded by force-stop.`);
      record(measured({
        id: METRIC_IDS.coldStart, label: LABELS.coldStart, unit: "ms", source: "adb",
        value: median(samples), samples, budget: budgets.coldStartMsMax, context: ctx, bound: "lower", notes: notesLocal,
      }));
    } catch (e) {
      fail(METRIC_IDS.coldStart, LABELS.coldStart, "ms", errText(e));
    }
  }

  // 2. Installed size.
  if (!installedPaths) {
    fail(METRIC_IDS.size, LABELS.size, "MB", "the app is not installed on the phone");
  } else {
    try {
      const sizes = parseStatSizes(shell(`stat -c %s ${installedPaths.join(" ")}`).stdout, installedPaths.length);
      const total = sizes.reduce((a, b) => a + b, 0);
      record(measured({
        id: METRIC_IDS.size, label: LABELS.size, unit: "MB", source: "adb",
        value: bytesToMb(total), budget: budgets.installedSizeMbMax, context: ctx, bound: "lower",
        notes: [`${installedPaths.length} APK file(s), decimal MB. Extracted native libraries, compiled code, data and cache are not included, so this is a lower bound: over budget is a FAIL, under budget is INCONCLUSIVE until the Settings figure is entered by hand.`],
      }));
    } catch (e) {
      fail(METRIC_IDS.size, LABELS.size, "MB", errText(e));
    }
  }

  // 3 and 4. Offline logging flow: memory, then the reconnect flush.
  const reasonNoFlows = opts.skipFlows
    ? "flows were skipped (--skip-flows)"
    : !opts.credentials
      ? "no test account: set MOBILE_E2E_EMAIL and MOBILE_E2E_PASSWORD (a test account, is_test = true)"
      : !installedPaths
        ? "the app is not installed on the phone"
        : opts.packageId !== DEFAULT_ANDROID_PACKAGE
          ? `the Maestro flows are written for ${DEFAULT_ANDROID_PACKAGE} only, not ${opts.packageId}`
          : null;
  if (reasonNoFlows) {
    fail(METRIC_IDS.memory, LABELS.memory, "MB", reasonNoFlows);
    fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", reasonNoFlows);
  } else if (opts.credentials) {
    runFlows(exec, opts, opts.credentials, budgets, ctx, shell, record, fail, notes);
  }

  // 5. Metrics only a person can time. A manual number fills a gap; it never overrides a measured one.
  for (const [id, value] of Object.entries(opts.manual)) {
    const meta = MANUAL_IDS.includes(id) ? MANUAL_UNITS[id] : undefined;
    if (!meta) { notes.push(`--manual ${id} ignored: unknown metric id.`); continue; }
    const existing = results.get(id);
    if (existing?.status === "measured") { notes.push(`--manual ${id}=${value} ignored: the harness measured this metric itself.`); continue; }
    record(measured({
      id, label: meta.label, unit: meta.unit, source: "manual", value, budget: budgetFor(id, budgets),
      context: ctx,
      notes: ["Entered by hand with --manual; the harness did not observe it and does not know how many runs it summarises."],
    }));
  }
  const manualReasons: Record<string, string> = {
    [METRIC_IDS.coldStartUsable]: "needs a person: time from tapping the icon to a usable screen with a stopwatch or screen recording (RUNBOOK step 6), median of 5, then pass --manual cold_start_usable_ms=<n>",
    [METRIC_IDS.sizeSettings]: "needs a person: Settings, Apps, TarragonHealth, Storage: the total, in MB (RUNBOOK step 6), then pass --manual installed_size_settings_mb=<n>",
    [METRIC_IDS.logWrite]: "needs a person: screen-record at 60 fps and count frames (RUNBOOK step 6), then pass --manual log_store_write_ms=<median of 10>",
    [METRIC_IDS.logVisible]: "needs a person: same recording as the store write, pass --manual log_visible_ms=<median of 10>",
    [METRIC_IDS.probe]: "needs a person: watch the data meter for an hour with one row waiting (RUNBOOK step 7), pass --manual probe_requests_per_minute=<n>",
  };
  for (const [id, reason] of Object.entries(manualReasons)) {
    if (!results.has(id)) {
      const meta = MANUAL_UNITS[id] as { unit: string; label: string };
      fail(id, meta.label, meta.unit, reason);
    }
  }

  const metrics = METRIC_ORDER.map((id) => {
    const m = results.get(id);
    if (!m) throw new Error(`internal: metric ${id} was never recorded`);
    return m;
  });
  return { device, app, metrics, notes };
}

type Shell = (cmd: string, timeoutMs?: number) => ExecResult;

const WAITING_RE = /waiting to send/;
/** The sync banner re-reads the queue every 15 s (apps/mobile/src/screens/sync-banner.tsx REFRESH_MS), so a cleared notice can lag the real flush by up to this. */
const BANNER_POLL_MS = 15_000;
const AIRPLANE_OFF_CMD = "cmd connectivity airplane-mode disable";

/** Reads the screen through uiautomator. Throws when it cannot, so the caller turns "could not look" into "not measured". */
function screenShows(shell: Shell, text: RegExp): boolean {
  return uiDumpContains(shell("uiautomator dump /dev/tty", 60_000).stdout, text);
}

function appInFocus(shell: Shell, pkg: string): boolean {
  return parseFocusedPackage(shell("dumpsys window | grep mCurrentFocus").stdout) === pkg;
}

function runFlows(
  exec: Exec,
  opts: AndroidOptions,
  creds: { readonly email: string; readonly password: string },
  budgets: DeviceLabBudgets,
  ctx: EvalContext,
  shell: Shell,
  record: (m: MetricResult) => void,
  fail: (id: string, label: string, unit: string, reason: string) => void,
  notes: string[],
): void {
  // The test account goes to Maestro through the child's environment (MAESTRO_ prefix), never through argv, so it is not visible in `ps`.
  const maestro = (flow: string, withCreds: boolean, timeoutMs: number, extra: readonly string[] = []): ExecResult => {
    const args = ["--device", opts.serial, "test", ...extra, `${opts.flowDir}/${flow}`];
    const env = withCreds ? { MAESTRO_MOBILE_E2E_EMAIL: creds.email, MAESTRO_MOBILE_E2E_PASSWORD: creds.password } : undefined;
    return exec("maestro", args, { timeoutMs, ...(env ? { env } : {}) });
  };

  try {
    // Baseline: how long Maestro takes to start and finish a flow that does nothing, so the flush time can be bounded.
    const overheads: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = maestro("noop.yaml", false, 120_000);
      if (!r.ok) throw new Error("the Maestro baseline flow (noop.yaml) failed: is Maestro installed and the phone authorised?");
      overheads.push(r.elapsedMs);
    }
    const overheadMs = median(overheads);

    const prep = maestro("prepare-offline-log.yaml", true, 420_000);
    if (/ETIMEDOUT/.test(prep.stderr)) notes.push("WARNING: Maestro timed out. A Maestro Java process may still be driving the phone: check `ps` and stop it before the next run.");
    if (!prep.ok) {
      const why = "the prepare-offline-log flow failed (login, a selector that differs on this build, or the rows never showed as waiting to send); run apps/mobile/.maestro/device-lab/prepare-offline-log.yaml with maestro by hand to see why";
      fail(METRIC_IDS.memory, LABELS.memory, "MB", why);
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", why);
      return;
    }

    // Memory with rows queued and the app alive.
    try {
      const kb = parseMeminfoTotalPssKb(shell(`dumpsys meminfo ${opts.packageId}`, 90_000).stdout);
      record(measured({
        id: METRIC_IDS.memory, label: LABELS.memory, unit: "MB", source: "adb", value: bytesToMb(kb * 1024),
        budget: budgets.memoryMbMax, context: ctx,
        notes: ["Taken once, right after logging 3 readings offline (not 1000 rows). Enter --manual memory_after_offline_flow_mb=<n> only if the harness could not measure."],
      }));
    } catch (e) {
      fail(METRIC_IDS.memory, LABELS.memory, "MB", errText(e));
    }

    // Preconditions for timing the flush. Each one failing means there is nothing to time, so the metric is "not measured", not a pass.
    let offline: boolean;
    try {
      offline = parseAirplaneMode(shell("settings get global airplane_mode_on").stdout);
    } catch (e) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", `airplane mode state unreadable after the prepare flow: ${errText(e)}`);
      return;
    }
    if (!offline) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", "the phone was not in airplane mode after the prepare flow, so there was nothing to reconnect from");
      return;
    }
    try {
      if (!appInFocus(shell, opts.packageId)) throw new Error("the app is not in the foreground");
      if (!screenShows(shell, /waiting to send: 3\b/)) throw new Error("the screen does not show 3 rows waiting to send");
    } catch (e) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", `could not confirm the queued rows before reconnecting: ${errText(e)}`);
      return;
    }

    const off = exec("adb", ["-s", opts.serial, "shell", AIRPLANE_OFF_CMD], { timeoutMs: 30_000 });
    if (!off.ok) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", "could not turn airplane mode off from adb (needs Android 11 or later; turn it off by hand and time the flush with a stopwatch)");
      return;
    }
    const check = exec("adb", ["-s", opts.serial, "shell", "settings get global airplane_mode_on"], { timeoutMs: 30_000 });
    let nowOffline = true;
    try { nowOffline = parseAirplaneMode(check.stdout); } catch { nowOffline = true; }
    if (nowOffline) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", "airplane mode is still on after the adb command, so the network did not return");
      return;
    }
    // Connectivity must really be back, or a stuck queue says nothing about the app. The time spent confirming it counts against the flush.
    let pingMs = 0;
    let online = false;
    for (let i = 0; i < 15 && !online; i += 1) {
      const p = exec("adb", ["-s", opts.serial, "shell", "ping -c 1 -W 3 8.8.8.8"], { timeoutMs: 20_000 });
      pingMs += p.elapsedMs;
      if (p.ok) online = true;
      else { opts.sleep(1000); pingMs += 1000; }
    }
    if (!online) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", "the phone has no working network after airplane mode went off (no Wi-Fi or SIM data, or ping is blocked), so a stuck queue says nothing about the app");
      return;
    }
    const ceilingMs = Math.round((budgets.reconnectFlushSecondsMax + 30) * 1000);
    const flush = maestro("assert-flushed.yaml", false, ceilingMs + 90_000, ["-e", `FLUSH_CEILING_MS=${ceilingMs}`]);
    if (/ETIMEDOUT/.test(flush.stderr)) notes.push("WARNING: Maestro timed out. A Maestro Java process may still be driving the phone: check `ps` and stop it before the next run.");
    const rawMs = check.elapsedMs + pingMs + flush.elapsedMs;
    const raw = rawMs / 1000;
    const corrected = Math.max(0, rawMs - overheadMs) / 1000;
    const budget = budgets.reconnectFlushSecondsMax;

    // What is on screen now, and is the app still the one in front. A cleared notice only counts if the app is still showing its list.
    let stillWaiting: boolean;
    let inFront: boolean;
    let delivered: boolean;
    let reportedFailure: boolean;
    try {
      const dump = shell("uiautomator dump /dev/tty", 60_000).stdout;
      stillWaiting = uiDumpContains(dump, WAITING_RE);
      delivered = uiDumpContains(dump, /Received by TarragonHealth/);
      reportedFailure = uiDumpContains(dump, /could not be saved|not sent yet/);
      inFront = appInFocus(shell, opts.packageId);
    } catch (e) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", `could not read the screen after reconnecting: ${errText(e)}`);
      return;
    }
    if (!inFront) {
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", "the app was no longer in the foreground after reconnecting (crash, lock screen or navigation), so a missing notice proves nothing");
      return;
    }
    if (reportedFailure) {
      notes.push("WARNING: after reconnecting the app showed a send failure (rows could not be saved, or are stuck). That is a possible data problem, not a timing result: look at the phone and the server.");
      fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", "REVIEW: after reconnecting the app showed a send failure (rows could not be saved, or are stuck). That is a possible data problem, not a timing result; look at the phone and the server");
      return;
    }
    if (!flush.ok || stillWaiting) {
      if (stillWaiting && corrected - BANNER_POLL_MS / 1000 > budget) {
        record(measured({
          id: METRIC_IDS.reconnect, label: LABELS.reconnect, unit: "s", source: "maestro", value: raw, budget, context: ctx, bound: "lower",
          notes: [
            `The queued rows were STILL waiting to send after the harness waited ${corrected.toFixed(1)} s (Maestro start-up removed). The value is how long it waited, a lower bound: the flush took at least this long, or never happened.`,
            "Check whether the rows reached the server before calling this a data-loss bug; the screen is the only evidence the harness has.",
          ],
        }));
        return;
      }
      fail(
        METRIC_IDS.reconnect, LABELS.reconnect, "s",
        stillWaiting
          ? "the rows were still waiting but the harness had not yet waited past the budget, so there is no result either way"
          : "the Maestro wait failed although the notice is gone; a selector or timing problem, not counted either way",
      );
      return;
    }
    const verdictOverride = raw <= budget
      ? (delivered
        ? { verdict: "PASS" as const, reason: null }
        : { verdict: "INCONCLUSIVE" as const, reason: "the waiting notice cleared in time, but the screen never showed \"Received by TarragonHealth.\", so delivery is unconfirmed (the rows may have been dropped); confirm on the dashboard" })
      : corrected - BANNER_POLL_MS / 1000 > budget
        ? { verdict: "FAIL" as const, reason: null }
        : { verdict: "INCONCLUSIVE" as const, reason: `the upper bound (${raw.toFixed(1)} s, includes Maestro start-up) is over the budget but the estimate after removing Maestro start-up and the banner's 15 s refresh lag (${(corrected - BANNER_POLL_MS / 1000).toFixed(1)} s) is not; repeat with a stopwatch` };
    record(measured({
      id: METRIC_IDS.reconnect, label: LABELS.reconnect, unit: "s", source: "maestro", value: raw, budget,
      context: ctx,
      verdictOverride,
      notes: [
        `Value is an UPPER BOUND: adb return to Maestro exit, which includes Maestro start-up (median ${(overheadMs / 1000).toFixed(1)} s measured on a do-nothing flow).`,
        `Estimate after removing that start-up: ${corrected.toFixed(1)} s.`,
        `Evidence: the screen showed 3 rows waiting to send with the app in front before reconnecting; afterwards no waiting notice, no send failure, the app still in front, and ${delivered ? "\"Received by TarragonHealth.\" on screen" : "NO delivery confirmation on screen"}; a ping to the internet worked before the wait began. The harness did NOT check the server; confirm the rows on the dashboard.`,
        `The sync banner refreshes every ${BANNER_POLL_MS / 1000} s, so the notice can clear up to that late. FAIL needs the estimate minus that lag to be over budget too.`,
        "PASS only when the upper bound is within budget (and delivery is shown); FAIL only when even the estimate minus the lag is over budget.",
      ],
    }));
  } catch (e) {
    const why = errText(e);
    fail(METRIC_IDS.memory, LABELS.memory, "MB", why);
    fail(METRIC_IDS.reconnect, LABELS.reconnect, "s", why);
  } finally {
    restoreNetwork(exec, opts.serial, shell, notes);
  }
}

/** Never leave a test phone offline. Tries the Android 11 command, then the older settings route, and reads the state back. */
function restoreNetwork(exec: Exec, serial: string, shell: Shell, notes: string[]): void {
  const run = (cmd: string): ExecResult => exec("adb", ["-s", serial, "shell", cmd], { timeoutMs: 30_000 });
  run(AIRPLANE_OFF_CMD);
  let off = false;
  try { off = !parseAirplaneMode(shell("settings get global airplane_mode_on").stdout); } catch { off = false; }
  if (!off) {
    run("settings put global airplane_mode_on 0");
    run("am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false");
    try { off = !parseAirplaneMode(shell("settings get global airplane_mode_on").stdout); } catch { off = false; }
  }
  if (!off) notes.push("WARNING: could not confirm airplane mode is off after the run. Turn it off by hand: the phone may be offline.");
}
