import { METRIC_IDS } from "./android";
import type { DeviceLabBudgets } from "./budgets";
import type { BuildKind } from "./parse";
import { measured, notMeasured, type AppInfo, type DeviceInfo, type MetricResult } from "./report";

/**
 * A real iPhone cannot be driven from this machine (no adb, no Maestro airplane mode). The harness still writes the same report so the run is
 * recorded in one format: every number is one a person timed (Xcode Instruments, Settings, a stopwatch) and passed with --manual, and tagged as such.
 */
const META: ReadonlyArray<{ id: string; label: string; unit: string; buildSensitive: boolean; budget: (b: DeviceLabBudgets) => number | null }> = [
  { id: METRIC_IDS.coldStartUsable, label: "Cold start to first usable screen (timed by hand)", unit: "ms", buildSensitive: true, budget: (b) => b.coldStartMsMax },
  { id: METRIC_IDS.sizeSettings, label: "Installed size (Settings, iPhone Storage)", unit: "MB", buildSensitive: true, budget: (b) => b.installedSizeMbMax },
  { id: METRIC_IDS.memory, label: "Memory after the offline-logging flow (Xcode)", unit: "MB", buildSensitive: true, budget: (b) => b.memoryMbMax },
  { id: METRIC_IDS.logWrite, label: "Log a reading: store write", unit: "ms", buildSensitive: true, budget: (b) => b.logStoreWriteMsMax },
  { id: METRIC_IDS.logVisible, label: "Log a reading: saved notice visible", unit: "ms", buildSensitive: true, budget: (b) => b.logVisibleMsMax },
  { id: METRIC_IDS.reconnect, label: "Reconnect flush after the network returns", unit: "s", buildSensitive: true, budget: (b) => b.reconnectFlushSecondsMax },
  { id: METRIC_IDS.probe, label: "Reachability probe cost with one row waiting", unit: "requests/min", buildSensitive: true, budget: (b) => b.probeRequestsPerMinuteMax },
];

export function collectManualOnly(args: {
  readonly deviceName: string;
  readonly bundleId: string;
  readonly buildKind: BuildKind;
  readonly buildLabel: string | null;
  readonly manual: Readonly<Record<string, number>>;
  readonly budgets: DeviceLabBudgets;
}): { device: DeviceInfo; app: AppInfo; metrics: MetricResult[]; notes: string[] } {
  const metrics: MetricResult[] = META.map((m) => {
    const budget = m.budget(args.budgets);
    const v = args.manual[m.id];
    if (v === undefined) return notMeasured(m.id, m.label, m.unit, budget, "not entered: time it on the iPhone (RUNBOOK) and pass --manual");
    return measured({
      id: m.id, label: m.label, unit: m.unit, source: "manual", value: v, budget,
      context: { realDevice: true, buildKind: args.buildKind, buildSensitive: m.buildSensitive },
      notes: ["Entered by hand with --manual; the harness did not observe it."],
    });
  });
  return {
    device: { platform: "ios", realDevice: true, id: args.deviceName, manufacturer: "Apple", model: args.deviceName, osVersion: null, sdk: null, ramMb: null },
    app: { packageId: args.bundleId, versionName: null, versionCode: null, buildKind: args.buildKind, buildLabel: args.buildLabel },
    metrics,
    notes: ["Hand-entered run on a real iPhone. The harness observed nothing; the build kind is what the person said it was (--build-kind)."],
  };
}
