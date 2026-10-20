import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Exec, type ExecResult } from "./android";
import { parseCliArgs } from "./args";
import { loadDeviceLabBudgets } from "./budgets";
import { run } from "./cli";
import * as fx from "./fixtures";
import { collectIos } from "./ios";
import { collectManualOnly } from "./manual";

const budgets = loadDeviceLabBudgets("2026-10-20");
const ok = (stdout: string, elapsedMs = 5): ExecResult => ({ ok: true, stdout, stderr: "", elapsedMs });
const bad: ExecResult = { ok: false, stdout: "", stderr: "nope", elapsedMs: 1 };

describe("Maestro flow defaults mirror the budget config", () => {
  const flowsDir = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "apps", "mobile", ".maestro", "flows");
  it.each(["airplane-offline-logging-reconnect-flush.yaml", "power-cut-restart-mid-queue.yaml"])("%s FLUSH_TIMEOUT_MS equals the reconnect budget", (file) => {
    const m = /FLUSH_TIMEOUT_MS: "(\d+)"/.exec(readFileSync(join(flowsDir, file), "utf8"));
    expect(Number(m?.[1])).toBe(budgets.reconnectFlushSecondsMax * 1000);
  });
  it("the harness ceiling default sits above the budget", () => {
    const dir = join(flowsDir, "..", "device-lab");
    const m = /FLUSH_CEILING_MS: "(\d+)"/.exec(readFileSync(join(dir, "assert-flushed.yaml"), "utf8"));
    expect(Number(m?.[1])).toBeGreaterThan(budgets.reconnectFlushSecondsMax * 1000);
  });
});

describe("arguments", () => {
  it("parses manual numbers and defaults", () => {
    const a = parseCliArgs(["--manual", "log_store_write_ms=30", "--manual", "log_visible_ms=120.5", "--skip-flows"]);
    expect(a.manual).toEqual({ log_store_write_ms: 30, log_visible_ms: 120.5 });
    expect(a.skipFlows).toBe(true);
    expect(a.platform).toBe("auto");
    expect(a.packageId).toBe("com.tarragonhealth.app");
  });
  it("rejects unknown ids, bad numbers, duplicates, bad run counts and unknown flags", () => {
    expect(() => parseCliArgs(["--manual", "nonsense=1"])).toThrow(/unknown metric/);
    expect(() => parseCliArgs(["--manual", "cold_start_ms=1"])).toThrow(/unknown metric/);
    expect(() => parseCliArgs(["--manual", "log_visible_ms=0"])).toThrow(/greater than zero/);
    expect(parseCliArgs(["--manual", "probe_requests_per_minute=0"]).manual).toEqual({ probe_requests_per_minute: 0 });
    expect(() => parseCliArgs(["--manual", "log_store_write_ms=fast"])).toThrow();
    expect(() => parseCliArgs(["--manual", "log_store_write_ms=1", "--manual", "log_store_write_ms=2"])).toThrow(/twice/);
    expect(() => parseCliArgs(["--runs", "0"])).toThrow();
    expect(() => parseCliArgs(["--platform", "windows"])).toThrow();
    expect(() => parseCliArgs(["--enforce"])).toThrow();
  });
});

describe("ios simulator", () => {
  it("never carries PASS or FAIL, and the iPhone-only metrics are not measured", () => {
    const exec: Exec = (cmd, args) => {
      if (cmd === "xcrun" && args[1] === "launch") return ok("com.tarragonhealth.mobile: 4242", 700);
      if (cmd === "xcrun" && args[1] === "terminate") return ok("");
      if (cmd === "xcrun" && args[1] === "get_app_container") return ok("/tmp/App.app\n");
      if (cmd === "du") return ok("48212\t/tmp/App.app");
      if (cmd === "ps") return ok(" 250000\n");
      return bad;
    };
    const r = collectIos(exec, { udid: "AAAA-1111", simulatorName: "iPhone 15", bundleId: "com.tarragonhealth.mobile", appPath: null, buildLabel: null, coldRuns: 3, settleMs: 0, sleep: () => undefined }, budgets);
    expect(r.metrics.map((m) => m.verdict)).toEqual(["NOT EVALUATED", "N/A", "NOT EVALUATED", "N/A", "NOT EVALUATED", "N/A", "N/A", "N/A", "N/A"]);
    expect(r.metrics[0]).toMatchObject({ status: "measured", source: "simctl" });
    expect(r.device.realDevice).toBe(false);
  });
  it("a failing launch gives not measured for cold start and memory", () => {
    const r = collectIos(() => bad, { udid: "AAAA-1111", simulatorName: "iPhone 15", bundleId: "x", appPath: null, buildLabel: null, coldRuns: 1, settleMs: 0, sleep: () => undefined }, budgets);
    expect(r.metrics.every((m) => m.status === "not measured")).toBe(true);
  });
});

describe("hand-entered iPhone run", () => {
  it("judges only what was entered, and needs a release build to say PASS", () => {
    const rel = collectManualOnly({ deviceName: "iPhone 12", bundleId: "b", buildKind: "release", buildLabel: null, manual: { cold_start_usable_ms: 1800, installed_size_settings_mb: 55 }, budgets });
    expect(rel.metrics.find((m) => m.id === "cold_start_usable_ms")?.verdict).toBe("PASS");
    expect(rel.metrics.find((m) => m.id === "installed_size_settings_mb")?.verdict).toBe("FAIL");
    expect(rel.metrics.find((m) => m.id === "reconnect_flush_seconds")?.status).toBe("not measured");
    const unk = collectManualOnly({ deviceName: "iPhone 12", bundleId: "b", buildKind: "unknown", buildLabel: null, manual: { cold_start_usable_ms: 1800 }, budgets });
    expect(unk.metrics.find((m) => m.id === "cold_start_usable_ms")?.verdict).toBe("INCONCLUSIVE");
  });
});

describe("run() end to end with a fake phone", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const exec: Exec = (cmd, args) => {
    const line = args.join(" ");
    if (cmd === "git") return ok("abc1234\n");
    if (cmd === "adb" && args[0] === "devices") return ok("List of devices attached\nR58M12ABCDE\tdevice\n");
    if (cmd === "adb") {
      const sh = args[args.indexOf("shell") + 1] ?? "";
      if (sh === "getprop") return ok(fx.GETPROP);
      if (sh === "cat /proc/meminfo") return ok(fx.PROC_MEMINFO);
      if (sh.startsWith("pm path")) return ok(fx.PM_PATH_SPLITS);
      if (sh.startsWith("dumpsys package")) return ok(fx.DUMPSYS_PACKAGE_RELEASE);
      if (sh.startsWith("cmd package")) return ok(fx.RESOLVE_ACTIVITY);
      if (sh.startsWith("am force-stop")) return ok("");
      if (sh.startsWith("am start")) return ok(fx.amStartCold(2100));
      if (sh.startsWith("stat")) return ok(fx.STAT_SIZES);
      if (sh === "cmd connectivity airplane-mode disable") return ok("");
    }
    return line ? bad : bad;
  };

  it("writes a markdown and a json report named by date and device, REPORT ONLY, with flows skipped", () => {
    const out = mkdtempSync(join(tmpdir(), "device-lab-"));
    dirs.push(out);
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const result = run(["--platform", "android", "--skip-flows", "--out-dir", out], exec, new Date("2026-10-20T10:00:00Z"));
    spy.mockRestore();
    expect(result).not.toBeNull();
    expect(readdirSync(out).sort()).toEqual(["2026-10-20-tecno-tecno-kg5k.json", "2026-10-20-tecno-tecno-kg5k.md"]);
    const json = JSON.parse(readFileSync(join(out, "2026-10-20-tecno-tecno-kg5k.json"), "utf8")) as { mode: string; completeness: string; measuredCount: number };
    expect(json).toMatchObject({ mode: "REPORT ONLY", completeness: "INCOMPLETE", measuredCount: 2 });
    expect(readFileSync(join(out, "2026-10-20-tecno-tecno-kg5k.md"), "utf8")).toContain("2 of 9 metrics measured (INCOMPLETE)");
  });

  it("cuts the full serial out of the committed files even when adb printed it in an error", () => {
    const out = mkdtempSync(join(tmpdir(), "device-lab-"));
    dirs.push(out);
    const leaky: Exec = (cmd, args, o) => {
      if (cmd === "adb" && (args[args.indexOf("shell") + 1] ?? "").startsWith("pm path")) return { ok: false, stdout: "", stderr: "error: device 'R58M12ABCDE' not found", elapsedMs: 1 };
      return exec(cmd, args, o);
    };
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    run(["--platform", "android", "--skip-flows", "--out-dir", out], leaky, new Date("2026-10-20T10:00:00Z"));
    spy.mockRestore();
    for (const f of readdirSync(out)) expect(readFileSync(join(out, f), "utf8")).not.toContain("R58M12ABCDE");
  });

  it("refuses to fall back to a simulator when an adb phone is attached but not ready", () => {
    const out = mkdtempSync(join(tmpdir(), "device-lab-"));
    dirs.push(out);
    const unauth: Exec = (cmd) => (cmd === "adb" ? ok("List of devices attached\nR58M12ABCDE\tunauthorized\n") : ok("{\"devices\":{}}"));
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const before = process.exitCode;
    const result = run(["--out-dir", out], unauth);
    const code = process.exitCode;
    process.exitCode = before;
    const msg = err.mock.calls.map((c) => String(c[0])).join(" ");
    err.mockRestore();
    expect(result).toBeNull();
    expect(code).toBe(2);
    expect(msg).toMatch(/not ready/);
  });

  it("never overwrites an earlier report from the same day", () => {
    const out = mkdtempSync(join(tmpdir(), "device-lab-"));
    dirs.push(out);
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    run(["--platform", "android", "--skip-flows", "--out-dir", out], exec, new Date("2026-10-20T10:00:00Z"));
    run(["--platform", "android", "--skip-flows", "--out-dir", out], exec, new Date("2026-10-20T11:00:00Z"));
    spy.mockRestore();
    expect(readdirSync(out)).toHaveLength(4);
    expect(readdirSync(out)).toContain("2026-10-20-tecno-tecno-kg5k-2.md");
  });

  it("writes nothing and exits 2 when no device is attached", () => {
    const out = mkdtempSync(join(tmpdir(), "device-lab-"));
    dirs.push(out);
    const none: Exec = (cmd) => (cmd === "adb" ? ok("List of devices attached\n") : bad);
    const err = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const before = process.exitCode;
    const result = run(["--platform", "android", "--out-dir", out], none);
    const code = process.exitCode;
    process.exitCode = before;
    err.mockRestore();
    expect(result).toBeNull();
    expect(code).toBe(2);
    expect(readdirSync(out)).toEqual([]);
  });
});
