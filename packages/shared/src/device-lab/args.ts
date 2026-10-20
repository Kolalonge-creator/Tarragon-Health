import { parseArgs } from "node:util";
import type { BuildKind } from "./parse";
import { MANUAL_IDS } from "./android";

export type Platform = "android" | "ios" | "ios-device" | "auto";

export interface CliArgs {
  readonly platform: Platform;
  readonly serial: string | null;
  readonly packageId: string;
  readonly bundleId: string;
  readonly apk: string | null;
  readonly app: string | null;
  readonly buildLabel: string | null;
  readonly note: string | null;
  readonly runs: number | null;
  readonly skipFlows: boolean;
  readonly manual: Readonly<Record<string, number>>;
  readonly outDir: string | null;
  readonly dryRun: boolean;
  readonly help: boolean;
  /** Only used by ios-device, where the harness cannot inspect the build. */
  readonly buildKind: BuildKind;
  readonly deviceName: string | null;
}

export const DEFAULT_ANDROID_PACKAGE = "com.tarragonhealth.app";
export const DEFAULT_IOS_BUNDLE = "com.tarragonhealth.mobile";

export const USAGE = `Usage: scripts/device-lab/run.sh [options]

  --platform android|ios|ios-device   default: android if an adb device is attached, else a booted iOS simulator
  --serial <adb serial>               required when more than one adb device is attached
  --package <id>                      Android package (default ${DEFAULT_ANDROID_PACKAGE})
  --bundle-id <id>                    iOS bundle id (default ${DEFAULT_IOS_BUNDLE})
  --apk <file>                        install this APK first (adb install -r)
  --app <dir>                         install this .app on the booted simulator first
  --label <text>                      build label for the report (for example the EAS build id)
  --note <text>                       free text for the report (for example "signed in, 40 readings synced")
  --runs <n>                          cold start runs (default from device_lab.budgets)
  --skip-flows                        skip the Maestro offline-logging flows (memory and reconnect become not measured)
  --manual <id>=<number>              a number you timed by hand; repeatable. ids: ${MANUAL_IDS.join(", ")}
  --build-kind release|debug          ios-device only: what you installed
  --device-name <text>                ios-device only: for example "iPhone 12"
  --out-dir <dir>                     default docs/device-lab
  --dry-run                           print the plan and the budgets, touch no device, write nothing
  --help

MOBILE_E2E_EMAIL and MOBILE_E2E_PASSWORD (a test account, is_test = true) are read from the environment for the Maestro flows.
Budgets are REPORT ONLY: the exit code is 0 whenever a report was written, whatever the numbers say.`;

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      platform: { type: "string" },
      serial: { type: "string" },
      package: { type: "string" },
      "bundle-id": { type: "string" },
      apk: { type: "string" },
      app: { type: "string" },
      label: { type: "string" },
      note: { type: "string" },
      runs: { type: "string" },
      "skip-flows": { type: "boolean" },
      manual: { type: "string", multiple: true },
      "build-kind": { type: "string" },
      "device-name": { type: "string" },
      "out-dir": { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  const platform = (values.platform ?? "auto") as string;
  if (!["android", "ios", "ios-device", "auto"].includes(platform)) throw new Error(`--platform must be android, ios, ios-device or auto (got ${platform})`);

  let runs: number | null = null;
  if (values.runs !== undefined) {
    if (!/^\d+$/.test(values.runs) || Number(values.runs) < 1 || Number(values.runs) > 50) throw new Error("--runs must be a whole number from 1 to 50");
    runs = Number(values.runs);
  }

  const manual: Record<string, number> = {};
  const known = new Set<string>(MANUAL_IDS);
  for (const item of values.manual ?? []) {
    const m = /^([a-z0-9_]+)=(\d+(?:\.\d+)?)$/.exec(item);
    if (!m || m[1] === undefined || m[2] === undefined) throw new Error(`--manual expects <id>=<non-negative number>, got "${item}"`);
    if (!known.has(m[1])) throw new Error(`--manual: unknown metric id "${m[1]}" (known: ${[...known].join(", ")})`);
    if (m[1] in manual) throw new Error(`--manual ${m[1]} given twice`);
    const n = Number(m[2]);
    // A timed value of zero is not a measurement. Only a probe rate can truly be zero.
    if (n === 0 && m[1] !== "probe_requests_per_minute") throw new Error(`--manual ${m[1]} must be greater than zero`);
    manual[m[1]] = n;
  }

  const bk = values["build-kind"] ?? "unknown";
  if (!["release", "debug", "unknown"].includes(bk)) throw new Error("--build-kind must be release or debug");

  return {
    platform: platform as Platform,
    serial: values.serial ?? null,
    packageId: values.package ?? DEFAULT_ANDROID_PACKAGE,
    bundleId: values["bundle-id"] ?? DEFAULT_IOS_BUNDLE,
    apk: values.apk ?? null,
    app: values.app ?? null,
    buildLabel: values.label ?? null,
    note: values.note ?? null,
    runs,
    skipFlows: values["skip-flows"] ?? false,
    manual,
    outDir: values["out-dir"] ?? null,
    dryRun: values["dry-run"] ?? false,
    help: values.help ?? false,
    buildKind: bk as BuildKind,
    deviceName: values["device-name"] ?? null,
  };
}
