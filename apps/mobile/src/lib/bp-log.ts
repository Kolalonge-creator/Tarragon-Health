import type { VitalReadingPayload } from "./api";
import type { BpChecklistSymptom, BpLogPlan } from "./bp-checklist";
import { enqueueGroup, flushOutbox, listOutbox, type EnqueueInput } from "./outbox";
import { supabase } from "./supabase";
import { loadActiveThresholds } from "./threshold-sync";
import { classifyVitalOffline, type OfflineVitalFlag } from "./vitals";

/**
 * Saving one blood pressure log with its optional pulse and ticked symptoms
 * (S07), and the one seam where on-device triage attaches.
 *
 * The seam is `TriageEvaluator`. Version 1 (`evaluateOnDevice`) adds no rules:
 * it wraps the existing on-device blood pressure check (classifyVitalOffline,
 * the synced thresholds) and treats any red-flag tick as a reason to show the
 * emergency guidance that is already bundled in the app (INV-06). Showing
 * guidance is not grading. S11/S12 replace this function with the governed
 * rules and record the rule version; until then it records the threshold
 * version it used. No language model is ever consulted here (INV-01).
 */
export interface TriageInput {
  systolic: number;
  diastolic: number;
  redFlagTicked: readonly BpChecklistSymptom[];
}

export interface TriageOutcome {
  /** "emergency" takes over the screen with the emergency guidance, "urgent" is an inline banner, null is nothing to say. */
  severity: "emergency" | "urgent" | null;
  /** The blood pressure check's own flag, with its English detail line. */
  bpFlag: OfflineVitalFlag | null;
  /** True when a red-flag symptom was ticked. */
  symptomFlag: boolean;
  /** Which threshold set the check used (INV-16). */
  thresholdVersion: string;
}

export type TriageEvaluator = (input: TriageInput) => Promise<TriageOutcome>;

export const evaluateOnDevice: TriageEvaluator = async (input) => {
  const [bpFlag, thresholds] = await Promise.all([
    classifyVitalOffline({ vital_type: "blood_pressure", systolic: input.systolic, diastolic: input.diastolic }),
    loadActiveThresholds(),
  ]);
  const symptomFlag = input.redFlagTicked.length > 0;
  const severity = symptomFlag || bpFlag?.severity === "emergency" ? "emergency" : (bpFlag?.severity ?? null);
  return { severity, bpFlag, symptomFlag, thresholdVersion: thresholds.version };
};

const NO_OUTCOME: TriageOutcome = { severity: null, bpFlag: null, symptomFlag: false, thresholdVersion: "unavailable" };

export interface LogBpResult {
  error?: string;
  outcome: TriageOutcome;
  /** The blood pressure row's id (its idempotency key), once it is saved on the phone. */
  clientReadingId?: string;
  /** Rows saved on the phone for this log (the reading, its pulse, its symptoms). */
  saved?: number;
  /** True once every row has reached the server. */
  syncedAll?: boolean;
  /** Rows still waiting on the phone (not sent yet, or refused). */
  remaining?: number;
  /** Support codes of rows the server refused; they stay on the phone, never dropped. */
  rejectedSupportCodes?: string[];
}

type OkPlan = Extract<BpLogPlan, { ok: true }>;

/**
 * Saves every row of the log on the phone in one step (all or none), then
 * tries to send. A red-flag symptom is queued before the reading, so it is
 * sent first and is never left behind a reading that already went. Triage can
 * fail or be slow and never stands between the patient and a saved reading.
 *
 * `onOutcome` is called the moment the on-device check is done, before anything
 * is saved or sent, so the emergency guidance can appear at once and never waits
 * on a slow or missing network.
 */
export async function logBpWithExtras(
  plan: OkPlan,
  beneficiaryProfileId?: string,
  evaluate: TriageEvaluator = evaluateOnDevice,
  onOutcome?: (outcome: TriageOutcome) => void,
): Promise<LogBpResult> {
  const outcome = await evaluate({
    systolic: plan.systolic,
    diastolic: plan.diastolic,
    redFlagTicked: plan.redFlagTicked,
  }).catch(() => NO_OUTCOME);
  onOutcome?.(outcome);

  let subjectId = beneficiaryProfileId;
  if (!subjectId) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    subjectId = session?.user?.id ?? "";
  }
  const common = { subjectId, beneficiaryProfileId };

  const inputs: EnqueueInput[] = [
    ...plan.symptoms.map(
      (s): EnqueueInput => ({
        ...common,
        kind: "symptom",
        payload: { symptom_type: s.symptom_type, severity: s.severity, description: s.description },
        danger: plan.redFlagTicked.includes(s.symptom_type),
      }),
    ),
    {
      ...common,
      kind: "vital",
      payload: { vital_type: "blood_pressure", systolic: plan.systolic, diastolic: plan.diastolic },
      danger: outcome.bpFlag !== null,
    },
    ...(plan.pulse === null
      ? []
      : [
          {
            ...common,
            kind: "vital",
            payload: { vital_type: "pulse", pulse_bpm: plan.pulse } satisfies VitalReadingPayload,
          } satisfies EnqueueInput,
        ]),
  ];

  let items;
  try {
    items = await enqueueGroup(inputs);
  } catch {
    return { error: "Couldn't save this on your phone. Try again.", outcome };
  }
  const bp = items.find((i) => i.kind === "vital" && (i.payload as VitalReadingPayload).vital_type === "blood_pressure");

  await flushOutbox();
  const ids = new Set(items.map((i) => i.clientId));
  const left = (await listOutbox()).filter((r) => ids.has(r.clientId));
  return {
    outcome,
    clientReadingId: bp?.clientId,
    saved: items.length,
    syncedAll: left.length === 0,
    remaining: left.length,
    rejectedSupportCodes: left.filter((r) => r.state === "rejected").map((r) => r.supportCode),
  };
}
