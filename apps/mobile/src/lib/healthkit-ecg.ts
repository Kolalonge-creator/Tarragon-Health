import { getHealthkitModule, isHealthKitPlatform } from "./healthkit";

/**
 * S70 (18.6): the Apple Watch ECG result, as the watch itself classified it.
 *
 * WHAT THIS DOES NOT DO. It never reads the voltage trace (`includeVoltages: false`), draws no rhythm of its own and applies no
 * algorithm. Apple's own classification is mapped to the four-value vocabulary the server takes, and only a device-flagged
 * irregular or inconclusive result leads to a clinician task (`report_device_ecg_result`, behind the `device_alerts_enabled`
 * guard). The patient is told their care team will take a look, never a rhythm name.
 *
 * NOT RUN ON A DEVICE. The library (@kingstinct/react-native-healthkit 14.0.2) exposes `queryElectrocardiogramSamples` and the
 * `HKElectrocardiogramType` read type, and this file loads it through the same guard as the rest of HealthKit (healthkit.ts), so
 * an Expo Go or non-iOS build gets "unavailable" and never touches the native module. Authorisation is requested only when the
 * patient taps the ECG button, not at startup, so the native-exception class documented beside READ_PERMISSIONS in healthkit.ts
 * cannot affect app boot. Whether the authorisation sheet and the query behave on real hardware is untested: it needs a real
 * EAS development build on an iPhone paired with an ECG-capable watch.
 */
export type EcgClassificationForServer = "sinus_rhythm" | "irregular_rhythm" | "inconclusive" | "not_classified";

export interface MappedEcgResult {
  classification: EcgClassificationForServer;
  /** The device maker's own wording, kept short. Stored for the clinician; not shown to the patient as a finding. */
  deviceResultText: string;
}

/** Apple's `HKElectrocardiogramClassification` names, as the library spells them. */
export function mapEcgClassification(appleClassification: string): MappedEcgResult {
  switch (appleClassification) {
    case "sinusRhythm":
      return { classification: "sinus_rhythm", deviceResultText: "Sinus rhythm" };
    case "atrialFibrillation":
      return { classification: "irregular_rhythm", deviceResultText: "Atrial fibrillation" };
    case "inconclusiveLowHeartRate":
      return { classification: "inconclusive", deviceResultText: "Inconclusive, low heart rate" };
    case "inconclusiveHighHeartRate":
      return { classification: "inconclusive", deviceResultText: "Inconclusive, high heart rate" };
    case "inconclusivePoorReading":
      return { classification: "inconclusive", deviceResultText: "Inconclusive, poor reading" };
    case "inconclusiveOther":
      return { classification: "inconclusive", deviceResultText: "Inconclusive" };
    default:
      return { classification: "not_classified", deviceResultText: "Not classified" };
  }
}

export type LatestEcgOutcome =
  | { status: "ok"; mapped: MappedEcgResult; recordedAt: string }
  | { status: "none" }
  | { status: "unavailable" };

const RECENT_DAYS = 14;

export async function readLatestWatchEcg(now: Date = new Date()): Promise<LatestEcgOutcome> {
  if (!isHealthKitPlatform()) return { status: "unavailable" };
  const healthkit = getHealthkitModule();
  if (!healthkit) return { status: "unavailable" };
  try {
    if (!(await healthkit.isHealthDataAvailable())) return { status: "unavailable" };
    await healthkit.requestAuthorization({ toRead: ["HKElectrocardiogramType"] });
    const samples = await healthkit.queryElectrocardiogramSamples({ limit: 1, ascending: false, includeVoltages: false });
    const latest = samples[0];
    if (!latest) return { status: "none" };
    const recordedAt = new Date(latest.endDate);
    if (Number.isNaN(recordedAt.getTime()) || now.getTime() - recordedAt.getTime() > RECENT_DAYS * 86_400_000) return { status: "none" };
    return { status: "ok", mapped: mapEcgClassification(latest.classification), recordedAt: recordedAt.toISOString() };
  } catch {
    return { status: "unavailable" };
  }
}
