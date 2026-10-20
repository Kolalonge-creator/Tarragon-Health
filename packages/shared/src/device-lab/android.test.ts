import { describe, expect, it } from "@jest/globals";
import { collectAndroid, type AndroidOptions, type Exec, type ExecResult } from "./android";
import { loadDeviceLabBudgets } from "./budgets";
import * as fx from "./fixtures";

const budgets = loadDeviceLabBudgets("2026-10-20");
const ok = (stdout: string, elapsedMs = 10): ExecResult => ({ ok: true, stdout, stderr: "", elapsedMs });
const bad = (stderr = "error: closed"): ExecResult => ({ ok: false, stdout: "", stderr, elapsedMs: 1 });

interface Plan {
  props?: string;
  pkg?: string;
  coldTimes?: number[];
  coldOutput?: string;
  meminfo?: string;
  airplaneAfterPrep?: string;
  airplaneAfterDisable?: string;
  prepOk?: boolean;
  flushOk?: boolean;
  flushMs?: number;
  noopMs?: number;
  stat?: string;
  disableOk?: boolean;
  uiBefore?: string;
  uiAfter?: string;
  focusBefore?: string;
  focusAfter?: string;
  /** What `settings get global airplane_mode_on` says after the final restore attempts. */
  stuckOffline?: boolean;
}

function fakeExec(plan: Plan = {}): { exec: Exec; calls: string[]; envs: Array<Record<string, string> | undefined> } {
  const calls: string[] = [];
  const envs: Array<Record<string, string> | undefined> = [];
  let cold = 0;
  let prepared = false;
  let disabled = false;
  const exec: Exec = (cmd, args, o) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    if (cmd === "maestro") envs.push(o?.env ? { ...o.env } : undefined);
    if (cmd === "maestro") {
      const flow = args[args.length - 1] ?? "";
      if (flow.endsWith("noop.yaml")) return ok("", plan.noopMs ?? 4000);
      if (flow.endsWith("prepare-offline-log.yaml")) { prepared = true; return plan.prepOk === false ? bad("flow failed") : ok("", 60_000); }
      if (flow.endsWith("assert-flushed.yaml")) return plan.flushOk === false ? { ...bad("timeout"), elapsedMs: plan.flushMs ?? 12_000 } : ok("", plan.flushMs ?? 12_000);
    }
    const sh = args[args.indexOf("shell") + 1] ?? "";
    if (line.includes(" shell ")) {
      if (sh === "getprop") return ok(plan.props ?? fx.GETPROP);
      if (sh === "cat /proc/meminfo") return ok(fx.PROC_MEMINFO);
      if (sh.startsWith("pm path")) return ok(plan.pkg ?? fx.PM_PATH_SPLITS);
      if (sh.startsWith("dumpsys package")) return ok(fx.DUMPSYS_PACKAGE_RELEASE);
      if (sh.startsWith("cmd package resolve-activity")) return ok(fx.RESOLVE_ACTIVITY);
      if (sh.startsWith("am force-stop")) return ok("");
      if (sh.startsWith("am start -W")) {
        if (plan.coldOutput) return ok(plan.coldOutput);
        const t = (plan.coldTimes ?? [2000, 2200, 2100, 2400, 2300])[cold] ?? 2000;
        cold += 1;
        return ok(fx.amStartCold(t));
      }
      if (sh.startsWith("stat -c")) return ok(plan.stat ?? fx.STAT_SIZES);
      if (sh.startsWith("dumpsys meminfo")) return ok(plan.meminfo ?? fx.MEMINFO_MODERN);
      if (sh === "cmd connectivity airplane-mode disable") { disabled = true; return plan.disableOk === false ? bad("unknown command") : ok(""); }
      if (sh === "settings get global airplane_mode_on") {
        if (!prepared) return ok("0");
        if (plan.stuckOffline) return ok("1");
        return ok(disabled ? (plan.airplaneAfterDisable ?? "0") : (plan.airplaneAfterPrep ?? "1"));
      }
      if (sh === "uiautomator dump /dev/tty") return ok(disabled ? (plan.uiAfter ?? fx.UI_DUMP_CLEAR) : (plan.uiBefore ?? fx.UI_DUMP_WAITING));
      if (sh === "dumpsys window | grep mCurrentFocus") return ok(disabled ? (plan.focusAfter ?? fx.FOCUS_APP) : (plan.focusBefore ?? fx.FOCUS_APP));
      if (sh.startsWith("settings put global airplane_mode_on") || sh.startsWith("am broadcast")) return ok("");
    }
    return bad(`unhandled: ${line}`);
  };
  return { exec, calls, envs };
}

const opts = (over: Partial<AndroidOptions> = {}): AndroidOptions => ({
  serial: "R58M12ABCDE",
  packageId: "com.tarragonhealth.app",
  apkPath: null,
  buildLabel: "eas test",
  flowDir: "/flows",
  skipFlows: false,
  credentials: { email: "t@tarragon.test", password: "pw-do-not-print" },
  manual: {},
  coldRuns: 5,
  settleMs: 0,
  sleep: () => undefined,
  ...over,
});

const byId = (r: ReturnType<typeof collectAndroid>, id: string) => {
  const m = r.metrics.find((x) => x.id === id);
  if (!m) throw new Error(`no metric ${id}`);
  return m;
};

describe("collectAndroid on a real phone with a release build", () => {
  const r = collectAndroid(fakeExec().exec, opts(), budgets);

  it("measures cold start as the median of the runs and judges it against the config budget", () => {
    const m = byId(r, "cold_start_ms");
    expect(m).toMatchObject({ status: "measured", value: 2200, source: "adb" });
    expect(m.samples).toEqual([2000, 2200, 2100, 2400, 2300]);
    expect(m.budget).toBe(budgets.coldStartMsMax);
    // First frame is only a lower bound on "first usable screen": under budget proves nothing.
    expect(m.verdict).toBe("INCONCLUSIVE");
  });
  it("a first-frame time over budget is a proven FAIL", () => {
    const slow = collectAndroid(fakeExec({ coldTimes: [4000, 4100, 4200, 4300, 4400] }).exec, opts(), budgets);
    expect(byId(slow, "cold_start_ms").verdict).toBe("FAIL");
  });
  it("sums the APK files for size", () => {
    expect(byId(r, "installed_size_mb")).toMatchObject({ status: "measured", verdict: "INCONCLUSIVE" });
    expect(byId(r, "installed_size_mb").value).toBeCloseTo(37.748736, 5);
  });
  it("records memory with no budget as NO BUDGET", () => {
    expect(byId(r, "memory_after_offline_flow_mb")).toMatchObject({ status: "measured", value: 141.024, verdict: "NO BUDGET" });
  });
  it("bounds the reconnect flush by Maestro start-up and passes only on the upper bound", () => {
    const m = byId(r, "reconnect_flush_seconds");
    expect(m.status).toBe("measured");
    expect(m.value).toBeCloseTo(12.01, 2); // flush 12000 ms plus the 10 ms settings read
    expect(m.verdict).toBe("PASS");
    expect(m.notes.join(" ")).toMatch(/UPPER BOUND/);
  });
  it("leaves the hand-timed metrics not measured, with the step to do", () => {
    for (const id of ["cold_start_usable_ms", "installed_size_settings_mb", "log_store_write_ms", "log_visible_ms", "probe_requests_per_minute"]) {
      expect(byId(r, id)).toMatchObject({ status: "not measured", verdict: "N/A", value: null });
      expect(byId(r, id).reason).toMatch(/--manual/);
    }
  });
  it("passes the test account in the child environment, never in argv", () => {
    const { exec, calls, envs } = fakeExec();
    collectAndroid(exec, opts(), budgets);
    expect(calls.join("\n")).not.toContain("pw-do-not-print");
    expect(calls.join("\n")).not.toContain("t@tarragon.test");
    expect(envs.some((e) => e?.["MAESTRO_MOBILE_E2E_PASSWORD"] === "pw-do-not-print")).toBe(true);
  });
  it("redacts the serial", () => expect(r.device.id).toBe("...BCDE"));
});

describe("fail-silent guards", () => {
  it("a hot start in the middle makes cold start not measured, not a pass", () => {
    const r = collectAndroid(fakeExec({ coldOutput: fx.AM_START_HOT }).exec, opts(), budgets);
    expect(byId(r, "cold_start_ms")).toMatchObject({ status: "not measured", verdict: "N/A" });
    expect(byId(r, "cold_start_ms").reason).toMatch(/HOT/);
  });
  it("a package that is not installed measures nothing", () => {
    const { exec } = fakeExec();
    const wrapped: Exec = (c, a, o) => (a.join(" ").includes("pm path") ? ok("") : exec(c, a, o));
    const r = collectAndroid(wrapped, opts(), budgets);
    for (const id of ["cold_start_ms", "installed_size_mb", "memory_after_offline_flow_mb", "reconnect_flush_seconds"]) {
      expect(byId(r, id).status).toBe("not measured");
    }
  });
  it("a debuggable build is never PASS", () => {
    const { exec } = fakeExec();
    const wrapped: Exec = (c, a, o) => (a.join(" ").includes("dumpsys package") ? ok(fx.DUMPSYS_PACKAGE_DEBUG) : exec(c, a, o));
    const r = collectAndroid(wrapped, opts(), budgets);
    expect(byId(r, "cold_start_ms").verdict).toBe("NOT EVALUATED");
    expect(byId(r, "installed_size_mb").verdict).toBe("NOT EVALUATED");
    expect(r.app.buildKind).toBe("debug");
  });
  it("an emulator never gets PASS or FAIL", () => {
    const r = collectAndroid(fakeExec({ props: fx.GETPROP_EMULATOR }).exec, opts(), budgets);
    expect(r.device.realDevice).toBe(false);
    for (const m of r.metrics) expect(["PASS", "FAIL"]).not.toContain(m.verdict);
  });
  it("no test account means the flow metrics are not measured and no flow is run", () => {
    const { exec, calls } = fakeExec();
    const r = collectAndroid(exec, opts({ credentials: null }), budgets);
    expect(byId(r, "reconnect_flush_seconds").reason).toMatch(/MOBILE_E2E_EMAIL/);
    expect(calls.some((c) => c.startsWith("maestro"))).toBe(false);
  });
  it("--skip-flows skips them", () => {
    const r = collectAndroid(fakeExec().exec, opts({ skipFlows: true }), budgets);
    expect(byId(r, "memory_after_offline_flow_mb").status).toBe("not measured");
  });
  it("a failed prepare flow does not produce a reconnect number", () => {
    const r = collectAndroid(fakeExec({ prepOk: false }).exec, opts(), budgets);
    expect(byId(r, "reconnect_flush_seconds")).toMatchObject({ status: "not measured", value: null });
    expect(byId(r, "memory_after_offline_flow_mb").status).toBe("not measured");
  });
  it("if the phone was not offline after the prepare flow there is nothing to time", () => {
    const r = collectAndroid(fakeExec({ airplaneAfterPrep: "0" }).exec, opts(), budgets);
    expect(byId(r, "reconnect_flush_seconds")).toMatchObject({ status: "not measured" });
    expect(byId(r, "reconnect_flush_seconds").reason).toMatch(/not in airplane mode/);
  });
  it("if airplane mode did not actually turn off, the flush is not timed", () => {
    const r = collectAndroid(fakeExec({ airplaneAfterDisable: "1" }).exec, opts(), budgets);
    expect(byId(r, "reconnect_flush_seconds").status).toBe("not measured");
  });
  it("a flush that never clears while the rows are still on screen is a FAIL, not an N/A", () => {
    const r = collectAndroid(fakeExec({ flushOk: false, flushMs: 90_000, uiAfter: fx.UI_DUMP_WAITING }).exec, opts(), budgets);
    const m = byId(r, "reconnect_flush_seconds");
    expect(m).toMatchObject({ status: "measured", verdict: "FAIL" });
    expect(m.notes.join(" ")).toMatch(/STILL waiting/);
  });
  it("a Maestro failure with the notice gone is a selector problem: not measured", () => {
    const r = collectAndroid(fakeExec({ flushOk: false, uiAfter: fx.UI_DUMP_CLEAR }).exec, opts(), budgets);
    expect(byId(r, "reconnect_flush_seconds")).toMatchObject({ status: "not measured", verdict: "N/A" });
  });
  it("a notice that vanished because the app left the foreground is not a flush", () => {
    const r = collectAndroid(fakeExec({ focusAfter: fx.FOCUS_LAUNCHER, flushMs: 100 }).exec, opts(), budgets);
    expect(byId(r, "reconnect_flush_seconds")).toMatchObject({ status: "not measured", verdict: "N/A" });
    expect(byId(r, "reconnect_flush_seconds").reason).toMatch(/foreground/);
  });
  it("without 3 rows visibly waiting before reconnecting there is nothing to time", () => {
    const r = collectAndroid(fakeExec({ uiBefore: fx.UI_DUMP_CLEAR }).exec, opts(), budgets);
    expect(byId(r, "reconnect_flush_seconds")).toMatchObject({ status: "not measured" });
    expect(byId(r, "reconnect_flush_seconds").reason).toMatch(/3 rows/);
    const r2 = collectAndroid(fakeExec({ focusBefore: fx.FOCUS_NONE }).exec, opts(), budgets);
    expect(byId(r2, "reconnect_flush_seconds").status).toBe("not measured");
  });
  it("warns loudly when the phone cannot be brought back online", () => {
    const r = collectAndroid(fakeExec({ stuckOffline: true }).exec, opts(), budgets);
    expect(r.notes.some((n) => n.startsWith("WARNING"))).toBe(true);
  });
  it("a debuggable build gets no PASS or FAIL on the flush either", () => {
    const { exec } = fakeExec();
    const wrapped: Exec = (c, a, o) => (a.join(" ").includes("dumpsys package") ? ok(fx.DUMPSYS_PACKAGE_DEBUG) : exec(c, a, o));
    expect(byId(collectAndroid(wrapped, opts(), budgets), "reconnect_flush_seconds").verdict).toBe("NOT EVALUATED");
  });
  it("FAIL only when even the estimate without Maestro start-up is over budget; between is INCONCLUSIVE", () => {
    const slow = collectAndroid(fakeExec({ flushMs: 90_000, noopMs: 4000 }).exec, opts(), budgets);
    expect(byId(slow, "reconnect_flush_seconds").verdict).toBe("FAIL");
    const edge = collectAndroid(fakeExec({ flushMs: 62_000, noopMs: 4000 }).exec, opts(), budgets);
    expect(byId(edge, "reconnect_flush_seconds").verdict).toBe("INCONCLUSIVE");
  });
  it("always tries to turn airplane mode off at the end, even after a failure", () => {
    const { exec, calls } = fakeExec({ prepOk: false });
    collectAndroid(exec, opts(), budgets);
    expect(calls.some((c) => c.includes("airplane-mode disable"))).toBe(true);
  });
  it("never writes the test password anywhere in the result", () => {
    const r = collectAndroid(fakeExec({ prepOk: false }).exec, opts(), budgets);
    expect(JSON.stringify(r)).not.toContain("pw-do-not-print");
  });
});

describe("manual numbers", () => {
  it("fill a gap, tagged manual, and are judged against the same budget", () => {
    const r = collectAndroid(fakeExec().exec, opts({ manual: { log_store_write_ms: 30, log_visible_ms: 450 } }), budgets);
    expect(byId(r, "log_store_write_ms")).toMatchObject({ status: "measured", source: "manual", value: 30, verdict: "PASS" });
    expect(byId(r, "log_visible_ms")).toMatchObject({ source: "manual", verdict: "FAIL" });
  });
  it("a hand-timed usable-screen cold start is the one that can PASS", () => {
    const r = collectAndroid(fakeExec().exec, opts({ manual: { cold_start_usable_ms: 2800, installed_size_settings_mb: 52 } }), budgets);
    expect(byId(r, "cold_start_usable_ms")).toMatchObject({ source: "manual", verdict: "PASS" });
    expect(byId(r, "installed_size_settings_mb")).toMatchObject({ source: "manual", verdict: "FAIL" });
  });
  it("never override something the harness measured", () => {
    const r = collectAndroid(fakeExec().exec, opts({ manual: { cold_start_ms: 1, memory_after_offline_flow_mb: 1 } }), budgets);
    expect(byId(r, "cold_start_ms").source).toBe("adb");
    expect(byId(r, "memory_after_offline_flow_mb").source).toBe("adb");
    expect(r.notes.join(" ")).toMatch(/ignored/);
  });
});
