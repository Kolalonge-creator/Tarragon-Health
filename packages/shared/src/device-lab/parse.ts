/**
 * Pure parsers for adb / simctl output. Every parser either returns a well-formed value or THROWS: none of them
 * returns NaN, 0 or an empty default for text it did not understand. A caller turns a throw into a metric that is
 * "not measured" with the reason; it must never turn it into a number.
 */

export interface AdbDevice {
  readonly serial: string;
  /** "device" is the only state that can be driven. */
  readonly state: string;
}

export function parseAdbDevices(out: string): AdbDevice[] {
  const lines = out.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("List of devices attached"));
  if (start < 0) throw new Error("adb devices: header line missing");
  const devices: AdbDevice[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line || line.startsWith("*")) continue; // blank, or "* daemon started successfully"
    const [serial, state] = line.split(/\s+/);
    if (!serial || !state) throw new Error(`adb devices: cannot read line "${line}"`);
    devices.push({ serial, state });
  }
  return devices;
}

export type LaunchState = "COLD" | "WARM" | "HOT";

export interface AmStartResult {
  readonly totalTimeMs: number;
  /** null when the device does not report it (before Android 10). */
  readonly launchState: LaunchState | null;
  readonly activity: string | null;
}

/** `adb shell am start -W -n <component>`. TotalTime is the time to the first frame, not to a usable screen. */
export function parseAmStartW(out: string): AmStartResult {
  if (/Error type|Error:|Exception/.test(out)) throw new Error("am start reported an error");
  if (/Warning: Activity not started/.test(out)) throw new Error("am start: activity was not started (it was already running)");
  const status = /^Status:\s*(\S+)/m.exec(out);
  if (status && status[1] !== "ok") throw new Error(`am start: status ${status[1]}`);
  const total = /^TotalTime:\s*(\d+)\s*$/m.exec(out);
  if (!total || total[1] === undefined) throw new Error("am start: no TotalTime in output");
  const ms = Number(total[1]);
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`am start: implausible TotalTime ${total[1]}`);
  const ls = /^LaunchState:\s*(COLD|WARM|HOT)\s*$/m.exec(out);
  const act = /^Activity:\s*(\S+)/m.exec(out);
  return {
    totalTimeMs: ms,
    launchState: ls ? (ls[1] as LaunchState) : null,
    activity: act?.[1] ?? null,
  };
}

/** `adb shell cmd package resolve-activity --brief <pkg>`: the last non-empty line is "pkg/.Activity". */
export function parseResolveActivity(out: string, pkg: string): string {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || !last.includes("/") || !last.startsWith(`${pkg}/`)) {
    throw new Error(`resolve-activity: no launcher activity for ${pkg}`);
  }
  return last;
}

/** `adb shell dumpsys meminfo <pkg>`: total PSS in kilobytes, from the newer "TOTAL PSS:" form or the older table row. */
export function parseMeminfoTotalPssKb(out: string): number {
  if (/No process found/i.test(out)) throw new Error("meminfo: the app process is not running");
  const modern = /TOTAL PSS:\s+(\d+)/.exec(out);
  const legacy = /^\s*TOTAL\s+(\d+)\b/m.exec(out);
  const hit = modern?.[1] ?? legacy?.[1];
  if (hit === undefined) throw new Error("meminfo: no TOTAL PSS found");
  const kb = Number(hit);
  if (!Number.isFinite(kb) || kb <= 0) throw new Error(`meminfo: implausible TOTAL PSS ${hit}`);
  return kb;
}

/** `adb shell pm path <pkg>`: every installed APK (base plus any splits). */
export function parsePmPath(out: string): string[] {
  const paths = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("package:"))
    .map((l) => l.slice("package:".length));
  if (paths.length === 0) throw new Error("pm path: the package is not installed");
  return paths;
}

/** `adb shell stat -c %s <file> ...`: one size per file, in order. A missing file or a count mismatch throws. */
export function parseStatSizes(out: string, expected: number): number[] {
  if (/No such file|stat:/i.test(out)) throw new Error("stat: a file could not be read");
  const sizes = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (!/^\d+$/.test(l)) throw new Error(`stat: unexpected line "${l}"`);
      return Number(l);
    });
  if (sizes.length !== expected) throw new Error(`stat: expected ${expected} sizes, got ${sizes.length}`);
  if (sizes.some((s) => s <= 0)) throw new Error("stat: a size was zero");
  return sizes;
}

/** `adb shell getprop`: "[key]: [value]" lines. */
export function parseGetprop(out: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of out.split(/\r?\n/)) {
    const m = /^\[([^\]]+)\]:\s*\[(.*)\]\s*$/.exec(line.trim());
    if (m && m[1] !== undefined) map[m[1]] = m[2] ?? "";
  }
  if (Object.keys(map).length === 0) throw new Error("getprop: no properties parsed");
  return map;
}

/** `/proc/meminfo` MemTotal in kilobytes. */
export function parseProcMemTotalKb(out: string): number {
  const m = /^MemTotal:\s+(\d+)\s*kB/m.exec(out);
  if (!m || m[1] === undefined) throw new Error("/proc/meminfo: no MemTotal");
  return Number(m[1]);
}

export type BuildKind = "release" | "debug" | "unknown";

export interface PackageInfo {
  readonly versionName: string | null;
  readonly versionCode: number | null;
  /** debug when the package carries the DEBUGGABLE flag; unknown when no flags line could be read. */
  readonly buildKind: BuildKind;
}

/** `adb shell dumpsys package <pkg>`. */
export function parseDumpsysPackage(out: string): PackageInfo {
  const vn = /versionName=(\S+)/.exec(out);
  const vc = /versionCode=(\d+)/.exec(out);
  const flags = /(?:pkgFlags|\bflags)=\[([^\]]*)\]/.exec(out);
  let buildKind: BuildKind = "unknown";
  if (flags && flags[1] !== undefined) buildKind = /\bDEBUGGABLE\b/.test(flags[1]) ? "debug" : "release";
  return {
    versionName: vn?.[1] ?? null,
    versionCode: vc?.[1] ? Number(vc[1]) : null,
    buildKind,
  };
}

/** `adb shell settings get global airplane_mode_on`: true/false, or throws when unreadable. */
export function parseAirplaneMode(out: string): boolean {
  const v = out.trim();
  if (v === "1") return true;
  if (v === "0") return false;
  throw new Error(`airplane_mode_on: unreadable value "${v}"`);
}

export interface BootedSimulator {
  readonly udid: string;
  readonly name: string;
}

/** `xcrun simctl list devices booted -j`. */
export function parseSimctlBooted(json: string): BootedSimulator[] {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null || !("devices" in parsed)) {
    throw new Error("simctl: no devices key");
  }
  const devices = (parsed as { devices: Record<string, unknown> }).devices;
  const out: BootedSimulator[] = [];
  for (const list of Object.values(devices)) {
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      if (typeof d !== "object" || d === null) continue;
      const rec = d as Record<string, unknown>;
      if (rec["state"] === "Booted" && typeof rec["udid"] === "string" && typeof rec["name"] === "string") {
        out.push({ udid: rec["udid"], name: rec["name"] });
      }
    }
  }
  return out;
}

/** `ps -o rss= -p <pid>` (kilobytes) on macOS. */
export function parsePsRssKb(out: string): number {
  const t = out.trim();
  if (!/^\d+$/.test(t)) throw new Error(`ps: unreadable rss "${t}"`);
  const kb = Number(t);
  if (kb <= 0) throw new Error("ps: zero rss");
  return kb;
}

/** `du -sk <dir>` on macOS: kilobytes. */
export function parseDuKb(out: string): number {
  const m = /^(\d+)\s/.exec(out.trim());
  if (!m || m[1] === undefined) throw new Error(`du: unreadable output "${out.trim()}"`);
  const kb = Number(m[1]);
  if (kb <= 0) throw new Error("du: zero size");
  return kb;
}

/** `xcrun simctl launch <udid> <bundle>`: "<bundle>: <pid>". */
export function parseSimctlLaunchPid(out: string): number {
  const m = /:\s*(\d+)\s*$/.exec(out.trim());
  if (!m || m[1] === undefined) throw new Error(`simctl launch: no pid in "${out.trim()}"`);
  return Number(m[1]);
}

/** `adb shell uiautomator dump /dev/tty`: true when the visible UI text matches. Throws if the output is not a UI hierarchy. */
export function uiDumpContains(out: string, text: RegExp): boolean {
  if (!/<hierarchy/.test(out)) throw new Error("uiautomator dump: no UI hierarchy in the output");
  return text.test(out);
}

/** `adb shell "dumpsys window | grep mCurrentFocus"`: the package in focus, or null when nothing has focus. Throws on unreadable output. */
export function parseFocusedPackage(out: string): string | null {
  const line = out.split(/\r?\n/).find((l) => l.includes("mCurrentFocus"));
  if (!line) throw new Error("dumpsys window: no mCurrentFocus line");
  if (/mCurrentFocus=null/.test(line)) return null;
  const m = /\s([a-zA-Z0-9_.]+)\/[a-zA-Z0-9_.$]+\}?/.exec(line);
  if (!m || m[1] === undefined) throw new Error(`dumpsys window: cannot read focus from "${line.trim()}"`);
  return m[1];
}
