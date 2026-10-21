import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectAndroid, type Exec, type ExecResult } from "./android";
import { DEFAULT_ANDROID_PACKAGE, parseCliArgs, USAGE, type CliArgs } from "./args";
import { loadDeviceLabBudgets } from "./budgets";
import { collectIos } from "./ios";
import { collectManualOnly } from "./manual";
import { parseAdbDevices, parseSimctlBooted } from "./parse";
import { buildReport, redactId, renderMarkdown, reportBaseName, type DeviceLabReport } from "./report";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Real process execution: an argument list, no shell, never throws. Command lines are never echoed (they can carry a test password). */
export const realExec: Exec = (cmd, args, opts) => {
  const start = Date.now();
  const r = spawnSync(cmd, [...args], {
    encoding: "utf8",
    timeout: opts?.timeoutMs ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
    ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  return {
    ok: r.status === 0 && r.error === undefined,
    stdout: r.stdout ?? "",
    stderr: (r.stderr ?? "") + (r.error ? ` ${r.error.message}` : ""),
    elapsedMs: Date.now() - start,
  } satisfies ExecResult;
};

const sleepMs = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Today in Africa/Lagos (UTC+1, no daylight saving), as YYYY-MM-DD. */
const lagosDate = (now: Date): string => new Date(now.getTime() + 3_600_000).toISOString().slice(0, 10);

/** The report is committed to a public repository: no full phone serial or simulator UDID may reach it, whatever adb printed in an error. */
function scrub(report: DeviceLabReport, secrets: readonly string[]): DeviceLabReport {
  let text = JSON.stringify(report);
  for (const s of secrets) {
    if (s.length >= 6) text = text.split(s).join(redactId(s));
  }
  return JSON.parse(text) as DeviceLabReport;
}

/** Never overwrite an earlier report: a second run the same day gets -2, -3, ... */
function freeBaseName(dir: string, base: string): string {
  for (let n = 1; n < 100; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!existsSync(join(dir, `${name}.md`)) && !existsSync(join(dir, `${name}.json`))) return name;
  }
  throw new Error(`too many reports for ${base}`);
}

function gitSha(exec: Exec): string | null {
  const r = exec("git", ["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"], { timeoutMs: 10_000 });
  return r.ok ? r.stdout.trim() || null : null;
}

function pickAndroidSerial(exec: Exec, wanted: string | null): string | null {
  const r = exec("adb", ["devices"], { timeoutMs: 20_000 });
  if (!r.ok) return null;
  const all = parseAdbDevices(r.stdout);
  const ready = all.filter((d) => d.state === "device");
  const notReady = all.filter((d) => d.state !== "device");
  if (wanted) {
    if (ready.some((d) => d.serial === wanted)) return wanted;
    const seen = parseAdbDevices(r.stdout).find((d) => d.serial === wanted);
    throw new Error(`--serial ${wanted}: ${seen ? `the phone is "${seen.state}" (accept the USB debugging prompt, or reconnect it)` : "no such adb device"}. Not falling back to another device.`);
  }
  if (notReady.length > 0 && ready.length === 0) {
    throw new Error(`an adb device is attached but not ready (${notReady.map((d) => `${d.serial}: ${d.state}`).join(", ")}). Accept the USB debugging prompt on the phone, or reconnect it. Not falling back to a simulator.`);
  }
  if (ready.length > 1) throw new Error(`more than one adb device is attached (${ready.map((d) => d.serial).join(", ")}); pass --serial`);
  return ready[0]?.serial ?? null;
}

export function run(argv: readonly string[], exec: Exec = realExec, now: Date = new Date()): { report: DeviceLabReport; markdown: string; baseName: string } | null {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n\n${USAGE}`);
    process.exitCode = 2;
    return null;
  }
  if (args.help) {
    console.log(USAGE);
    return null;
  }
  const budgets = loadDeviceLabBudgets();
  if (budgets.configStatus === "proposed") console.log(`Budgets: device_lab.budgets v${budgets.configVersion} (PROPOSED). REPORT ONLY.`);

  let platform = args.platform;
  let serial: string | null = null;
  let sim: { udid: string; name: string } | null = null;
  if (platform === "auto" || platform === "android") {
    if (platform === "android" || !args.dryRun) {
      try { serial = pickAndroidSerial(exec, args.serial); } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 2;
        return null;
      }
    }
    if (serial) platform = "android";
  }
  if (platform === "auto" || platform === "ios") {
    const r = exec("xcrun", ["simctl", "list", "devices", "booted", "-j"], { timeoutMs: 20_000 });
    if (r.ok) {
      const booted = parseSimctlBooted(r.stdout);
      const first = booted[0];
      if (first) sim = first;
    }
    if (sim) platform = "ios";
  }

  if (args.dryRun) {
    console.log(JSON.stringify({ dryRun: true, platform, serial, simulator: sim, budgets, note: "nothing was measured and nothing was written" }, null, 2));
    return null;
  }

  const runs = args.runs ?? budgets.coldStartRuns;
  let collected: { device: DeviceLabReport["device"]; app: DeviceLabReport["app"]; metrics: DeviceLabReport["metrics"]; notes: readonly string[] };
  if (platform === "android" && serial) {
    const email = process.env["MOBILE_E2E_EMAIL"];
    const password = process.env["MOBILE_E2E_PASSWORD"];
    collected = collectAndroid(exec, {
      serial,
      packageId: args.packageId || DEFAULT_ANDROID_PACKAGE,
      apkPath: args.apk,
      buildLabel: args.buildLabel,
      flowDir: join(REPO_ROOT, "apps/mobile/.maestro/device-lab"),
      skipFlows: args.skipFlows,
      credentials: email && password ? { email, password } : null,
      manual: args.manual,
      coldRuns: runs,
      settleMs: 2000,
      sleep: sleepMs,
    }, budgets);
  } else if (platform === "ios" && sim) {
    collected = collectIos(exec, {
      udid: sim.udid, simulatorName: sim.name, bundleId: args.bundleId, appPath: args.app, buildLabel: args.buildLabel,
      coldRuns: runs, settleMs: 2000, sleep: sleepMs,
    }, budgets);
  } else if (platform === "ios-device") {
    collected = collectManualOnly({
      deviceName: args.deviceName ?? "iPhone", bundleId: args.bundleId, buildKind: args.buildKind, buildLabel: args.buildLabel,
      manual: args.manual, budgets,
    });
  } else {
    console.error("No device found: attach an Android phone with USB debugging (adb devices), boot an iOS simulator, or use --platform ios-device with --manual numbers.");
    process.exitCode = 2;
    return null;
  }

  const notes = [...collected.notes];
  if (platform === "ios" && Object.keys(args.manual).length > 0) notes.push("--manual values were IGNORED: this is a simulator run. Use --platform ios-device for a real iPhone.");
  if (args.note) notes.push(`Run note: ${args.note}`);
  const report = scrub(buildReport({
    generatedAt: now.toISOString(),
    gitSha: gitSha(exec),
    budgets,
    device: collected.device,
    app: collected.app,
    metrics: collected.metrics,
    notes,
  }), [serial ?? "", sim?.udid ?? ""]);
  const markdown = renderMarkdown(report);
  const outDir = args.outDir ?? join(REPO_ROOT, "docs/device-lab");
  mkdirSync(outDir, { recursive: true });
  const baseName = freeBaseName(outDir, reportBaseName(lagosDate(now), report.device));
  writeFileSync(join(outDir, `${baseName}.md`), markdown);
  writeFileSync(join(outDir, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\n${report.measuredCount} of ${report.totalCount} metrics measured (${report.completeness}). REPORT ONLY.`);
  for (const m of report.metrics) {
    console.log(`  ${m.status === "measured" ? "measured    " : "not measured"}  ${m.verdict.padEnd(13)} ${m.label}${m.reason ? `  [${m.reason}]` : ""}`);
  }
  for (const n of report.notes) if (n.startsWith("WARNING")) console.error(n);
  console.log(`\nWrote ${join(outDir, `${baseName}.md`)} and .json`);
  return { report, markdown, baseName };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run(process.argv.slice(2));
}
