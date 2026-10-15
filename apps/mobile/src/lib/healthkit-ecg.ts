import { Platform } from "react-native";
import { loadHealthkit } from "./healthkit";
import { postDeviceRhythmResult, type PostDeviceRhythmResult } from "./api";
import { recordSyncError } from "./sync-diagnostics";

/**
 * Personal ECG results from the phone's own health data (S70a, 18.6, decision S70-3). No vendor API and no tracing leaves the phone: only
 * the classification label the watch itself produced, stored verbatim. The platform never interprets a tracing, never shows the person a
 * diagnosis, and a result that is not clearly normal becomes one routine task for the care team (server side, behind its own switch).
 *
 * NEVER RUN ON A REAL DEVICE. HealthKit needs a real EAS build on physical hardware (and an Apple Watch with ECG), like the rest of the
 * HealthKit bridge. The label map below is Apple's own enum, copied word for word from the HealthKit documentation as exposed by the
 * installed package; it is the seam to correct on the first real sample.
 */
export interface EcgClassificationSample {
  uuid: string;
  startDate: Date;
  classification: string;
  averageHeartRateBpm?: number;
}

/** The device's own wording for each class. Stored as the label; never shown to the patient as a diagnosis. */
export const HEALTHKIT_ECG_LABEL: Record<string, string> = {
  sinusRhythm: "Sinus rhythm",
  atrialFibrillation: "Atrial fibrillation",
  inconclusiveLowHeartRate: "Inconclusive: low heart rate",
  inconclusiveHighHeartRate: "Inconclusive: high heart rate",
  inconclusivePoorReading: "Inconclusive: poor recording",
  inconclusiveOther: "Inconclusive",
  notSet: "Unclassified",
};

export function labelFor(classification: string): string {
  return HEALTHKIT_ECG_LABEL[classification] ?? `Unrecognised: ${classification}`.slice(0, 200);
}

/** Reads the ECG classifications since a date. Returns null when HealthKit or the ECG type is not available (Expo Go, Android, no watch). */
export async function readEcgClassifications(since: Date): Promise<EcgClassificationSample[] | null> {
  if (Platform.OS !== "ios") return null;
  const hk = loadHealthkit();
  if (!hk) return null;
  try {
    const granted = await hk.requestAuthorization({ toRead: ["HKElectrocardiogramType"] });
    if (!granted) return null;
    // Same query-option shape the bridge's quantity reads use (src/lib/healthkit.ts); the voltages are never requested.
    const samples = await hk.queryElectrocardiogramSamples({
      filter: { date: { startDate: since, endDate: new Date() } },
      limit: 20,
      ascending: false,
      includeVoltages: false,
    } as Parameters<typeof hk.queryElectrocardiogramSamples>[0]);
    return samples.map((s) => ({
      uuid: String(s.uuid),
      startDate: new Date(s.startDate),
      classification: String(s.classification),
      averageHeartRateBpm: s.averageHeartRateBpm,
    }));
  } catch (error) {
    recordSyncError("apple_health", "readEcgClassifications", error);
    return null;
  }
}

export interface EcgSyncOutcome {
  sent: number;
  duplicates: number;
  failed: number;
  /** True when the server said a red symptom was answered yes: the screen must show the existing emergency guidance. */
  redPath: boolean;
  /** The fixed sentence, shown once if any result needed the care team. */
  patientCopy: string | null;
}

/**
 * Sends each new ECG classification to the server. Idempotent: the server keys on the sample's uuid, so a re-read sends nothing twice. A
 * failure is counted, never swallowed as "nothing to send". `ask` is how the screen collects "are you having chest pain, fainting or
 * shortness of breath right now?" for a result that is not clearly normal; null means the person was not asked.
 */
export async function syncEcgResults(
  samples: readonly EcgClassificationSample[],
  options: { patientId?: string; send?: typeof postDeviceRhythmResult; symptoms?: ("chest_pain" | "fainting" | "breathlessness")[] } = {},
): Promise<EcgSyncOutcome> {
  const send = options.send ?? postDeviceRhythmResult;
  const out: EcgSyncOutcome = { sent: 0, duplicates: 0, failed: 0, redPath: false, patientCopy: null };
  for (const sample of samples) {
    const result: PostDeviceRhythmResult = await send({
      source: "healthkit_ecg",
      device_label: labelFor(sample.classification),
      device_name: "Apple Watch",
      recorded_at: sample.startDate.toISOString(),
      external_id: sample.uuid,
      ...(options.symptoms && options.symptoms.length > 0 ? { symptoms: options.symptoms } : {}),
      ...(options.patientId ? { patient_id: options.patientId } : {}),
    });
    if (!result.ok) {
      out.failed += 1;
      continue;
    }
    if (result.duplicate) out.duplicates += 1;
    else out.sent += 1;
    if (result.redPath) out.redPath = true;
    out.patientCopy ??= result.patientCopy;
  }
  return out;
}
