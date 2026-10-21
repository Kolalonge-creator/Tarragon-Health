import { describe, expect, it } from "@jest/globals";
import * as fx from "./fixtures";
import {
  parseAdbDevices,
  parseAirplaneMode,
  parseAmStartW,
  parseDuKb,
  parseDumpsysPackage,
  parseGetprop,
  parseMeminfoTotalPssKb,
  parsePmPath,
  parsePsRssKb,
  parseProcMemTotalKb,
  parseResolveActivity,
  parseSimctlBooted,
  parseSimctlLaunchPid,
  parseStatSizes,
  parseFocusedPackage,
  uiDumpContains,
} from "./parse";

describe("adb devices", () => {
  it("reads serials and states, skipping daemon noise", () => {
    expect(parseAdbDevices(fx.ADB_DEVICES)).toEqual([
      { serial: "R58M12ABCDE", state: "device" },
      { serial: "emulator-5554", state: "offline" },
      { serial: "ZY22XXXXXX", state: "unauthorized" },
    ]);
  });
  it("throws when the header is missing rather than returning no devices", () => {
    expect(() => parseAdbDevices("adb: command not found")).toThrow(/header/);
  });
});

describe("am start -W", () => {
  it("reads a cold start", () => {
    expect(parseAmStartW(fx.AM_START_COLD)).toEqual({ totalTimeMs: 2410, launchState: "COLD", activity: "com.tarragonhealth.app/.MainActivity" });
  });
  it("reports launchState null on Android before 10", () => {
    expect(parseAmStartW(fx.AM_START_OLD_ANDROID)).toMatchObject({ totalTimeMs: 3010, launchState: null });
  });
  it("returns HOT so the caller can reject it", () => {
    expect(parseAmStartW(fx.AM_START_HOT).launchState).toBe("HOT");
  });
  it("refuses an activity that was not started (already running)", () => {
    expect(() => parseAmStartW(fx.AM_START_NOT_STARTED)).toThrow(/not started/);
  });
  it("refuses an error", () => {
    expect(() => parseAmStartW(fx.AM_START_ERROR)).toThrow();
  });
  it("refuses output with no TotalTime instead of returning 0", () => {
    expect(() => parseAmStartW("Status: ok\nLaunchState: COLD\n")).toThrow(/TotalTime/);
  });
});

describe("resolve-activity", () => {
  it("returns the component on the last line", () => {
    expect(parseResolveActivity(fx.RESOLVE_ACTIVITY, "com.tarragonhealth.app")).toBe("com.tarragonhealth.app/.MainActivity");
  });
  it("throws for another package or none", () => {
    expect(() => parseResolveActivity("No activity found", "com.tarragonhealth.app")).toThrow();
    expect(() => parseResolveActivity("other.app/.Main", "com.tarragonhealth.app")).toThrow();
  });
});

describe("dumpsys meminfo", () => {
  it("reads the modern TOTAL PSS", () => expect(parseMeminfoTotalPssKb(fx.MEMINFO_MODERN)).toBe(141024));
  it("reads the legacy table row", () => expect(parseMeminfoTotalPssKb(fx.MEMINFO_LEGACY)).toBe(98765));
  it("throws when the process is not running instead of reporting zero", () => {
    expect(() => parseMeminfoTotalPssKb(fx.MEMINFO_NO_PROCESS)).toThrow(/not running/);
  });
  it("throws on unrecognised text", () => expect(() => parseMeminfoTotalPssKb("hello")).toThrow());
});

describe("package size", () => {
  it("lists base and split APKs", () => expect(parsePmPath(fx.PM_PATH_SPLITS)).toHaveLength(2));
  it("throws when not installed", () => expect(() => parsePmPath("")).toThrow(/not installed/));
  it("reads sizes and checks the count", () => {
    expect(parseStatSizes(fx.STAT_SIZES, 2)).toEqual([31457280, 6291456]);
    expect(() => parseStatSizes(fx.STAT_SIZES, 3)).toThrow(/expected 3/);
  });
  it("throws on a missing file, a non-number, or a zero size", () => {
    expect(() => parseStatSizes("stat: '/x': No such file or directory", 1)).toThrow();
    expect(() => parseStatSizes("abc", 1)).toThrow();
    expect(() => parseStatSizes("0", 1)).toThrow();
  });
});

describe("device properties", () => {
  it("parses getprop", () => {
    const p = parseGetprop(fx.GETPROP);
    expect(p["ro.product.model"]).toBe("TECNO KG5k");
    expect(p["ro.kernel.qemu"]).toBe("");
  });
  it("throws on empty", () => expect(() => parseGetprop("")).toThrow());
  it("reads MemTotal", () => expect(parseProcMemTotalKb(fx.PROC_MEMINFO)).toBe(1873456));
  it("throws without MemTotal", () => expect(() => parseProcMemTotalKb("x")).toThrow());
});

describe("build kind", () => {
  it("release when flags carry no DEBUGGABLE", () => {
    expect(parseDumpsysPackage(fx.DUMPSYS_PACKAGE_RELEASE)).toEqual({ versionName: "0.2.0", versionCode: 42, buildKind: "release" });
  });
  it("debug when DEBUGGABLE", () => expect(parseDumpsysPackage(fx.DUMPSYS_PACKAGE_DEBUG).buildKind).toBe("debug"));
  it("debug from the older pkgFlags line", () => expect(parseDumpsysPackage(fx.DUMPSYS_PACKAGE_OLD_FLAGS).buildKind).toBe("debug"));
  it("unknown, never release, when no flags line is readable", () => {
    expect(parseDumpsysPackage("versionName=1.0").buildKind).toBe("unknown");
  });
});

describe("airplane mode", () => {
  it("reads 1 and 0", () => {
    expect(parseAirplaneMode("1\n")).toBe(true);
    expect(parseAirplaneMode("0\n")).toBe(false);
  });
  it("throws on null or noise so offline is never assumed", () => {
    expect(() => parseAirplaneMode("null")).toThrow();
    expect(() => parseAirplaneMode("")).toThrow();
  });
});

describe("simulator output", () => {
  it("lists booted simulators only", () => expect(parseSimctlBooted(fx.SIMCTL_BOOTED)).toEqual([{ udid: "AAAA-1111", name: "iPhone 15" }]));
  it("throws on malformed json", () => expect(() => parseSimctlBooted("{}")).toThrow());
  it("reads ps rss, du and the launch pid", () => {
    expect(parsePsRssKb(" 123456\n")).toBe(123456);
    expect(() => parsePsRssKb("")).toThrow();
    expect(parseDuKb("48212\t/path/App.app\n")).toBe(48212);
    expect(() => parseDuKb("du: error")).toThrow();
    expect(parseSimctlLaunchPid("com.tarragonhealth.mobile: 4242\n")).toBe(4242);
    expect(() => parseSimctlLaunchPid("error")).toThrow();
  });
});

describe("screen evidence", () => {
  it("finds visible text in a UI dump and throws when the dump is not a hierarchy", () => {
    expect(uiDumpContains(fx.UI_DUMP_WAITING, /waiting to send: 3/)).toBe(true);
    expect(uiDumpContains(fx.UI_DUMP_CLEAR, /waiting to send/)).toBe(false);
    expect(() => uiDumpContains("ERROR: could not get idle state", /x/)).toThrow(/hierarchy/);
  });
  it("reads the focused package, null for no focus, and throws on noise", () => {
    expect(parseFocusedPackage(fx.FOCUS_APP)).toBe("com.tarragonhealth.app");
    expect(parseFocusedPackage(fx.FOCUS_LAUNCHER)).toBe("com.android.launcher3");
    expect(parseFocusedPackage(fx.FOCUS_NONE)).toBeNull();
    expect(() => parseFocusedPackage("")).toThrow();
  });
});
