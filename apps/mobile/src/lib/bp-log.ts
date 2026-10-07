import type { VitalReadingPayload } from "./api";
import type { BpChecklistSymptom, BpLogPlan } from "./bp-checklist";
import type { SymptomCode } from "@tarragon/clinical";
import { t } from "@tarragon/i18n";
import { enqueueGroup, flushOutbox, listOutbox, type EnqueueInput } from "./outbox";
import { gradeOnDevice, type DeviceTriage } from "./triage-device";
import { supabase } from "./supabase";
import { loadActiveThresholds } from "./threshold-sync";
import { classifyVitalOffline, type OfflineVitalFlag } from "./vitals";

/**
 * Saving one blood pressure log with its optional pulse and ticked symptoms
 * (S07), and the one seam where on-device triage attaches.
 *
 * The seam is `TriageEvaluator`. It runs two checks side by side and shows the stricter: the
 * existing on-device blood pressure check (classifyVitalOffline, the synced thresholds, which is
 * also what the live server alerts use) and, from S12, the governed triage engine
 * (`gradeOnDevice`, the same pure rules as the server, from `@tarragon/clinical`). The engine can
 * only ADD guidance (OQ-88: its rule set is a draft until the Chief Medical Officer signs it), never
 * remove what the older check shows. A red-flag tick always shows the emergency guidance already
 * bundled in the app (INV-06). The engine's rule set version is recorded on the outcome (INV-16).
 * No language model is ever consulted here (INV-01).
 */
export interface TriageInput {
  systolic: number;
  diastolic: number;
  redFlagTicked: readonly BpChecklistSymptom[];
  /** Every symptom ticked on the form (not only the red-flag ones); the engine reads them all. */
  symptoms?: readonly BpChecklistSymptom[];
  /** Whose readings these are, for the on-device history; without it the engine still grades every red rule. */
  subjectId?: string;
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
  /** The governed engine's answer (S12), or null when it could not run. */
  device: DeviceTriage | null;
}

export type TriageEvaluator = (input: TriageInput) => Promise<TriageOutcome>;

export const evaluateOnDevice: TriageEvaluator = async (input) => {
  // A failed blood pressure check must not hide the red-flag symptom check, which needs no thresholds.
  const [bpFlag, thresholds, device] = await Promise.all([
    classifyVitalOffline({ vital_type: "blood_pressure", systolic: input.systolic, diastolic: input.diastolic }).catch(
      () => null,
    ),
    loadActiveThresholds().catch(() => null),
    // The engine never throws, but a bug in it must not hide the older check either.
    gradeOnDevice({
      subjectId: input.subjectId ?? "",
      systolic: input.systolic,
      diastolic: input.diastolic,
      symptoms: (input.symptoms ?? input.redFlagTicked) as readonly SymptomCode[],
      // Not answered here: a reading at or above the rule set's question line (params.extreme: 200/130 in the approved version 3, 180/120 in the draft version 4) asks the emergency-symptom question first (symptom-question.ts).
      // Ticking a symptom on the form answers it, which the engine reads from the symptoms themselves.
    }).catch(() => null),
  ]);
  const symptomFlag = input.redFlagTicked.length > 0;
  const legacy = symptomFlag || bpFlag?.severity === "emergency" ? "emergency" : (bpFlag?.severity ?? null);
  // The stricter of the two: the engine adds guidance, it never takes any away (OQ-88) ...
  // ... except for the very high band once the Chief Medical Officer has approved the rule set: there the engine asks the
  // symptom question (or sets the rest and 2 hour recheck) instead of the older check's blanket emergency.
  // A ticked red-flag symptom is never softened.
  const engineLeads =
    device?.ruleSet.status === "approved" && (device.result.status === "symptom_check_required" || device.result.ruleId === "BP-X2");
  const severity = device?.severity === "emergency" ? "emergency" : engineLeads && !symptomFlag ? null : legacy;
  return { severity, bpFlag, symptomFlag, thresholdVersion: thresholds?.version ?? "unavailable", device };
};

/** What to use when the evaluator itself fails: nothing from the reading, but a ticked red flag still counts. */
function fallbackOutcome(input: TriageInput): TriageOutcome {
  const symptomFlag = input.redFlagTicked.length > 0;
  return { severity: symptomFlag ? "emergency" : null, bpFlag: null, symptomFlag, thresholdVersion: "unavailable", device: null };
}

const SUBJECT_WAIT_MS = 250;

/** Who is being logged for: the dependant if given, else the signed-in user; empty when the session cannot be read quickly. */
async function resolveSubject(beneficiaryProfileId?: string): Promise<string> {
  if (beneficiaryProfileId) return beneficiaryProfileId;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(""), SUBJECT_WAIT_MS);
  });
  const read = supabase.auth
    .getSession()
    .then(({ data: { session } }) => session?.user?.id ?? "")
    .catch(() => "");
  try {
    return await Promise.race([read, slow]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
 * sent first when the network and server allow. A symptom the server errors on is
 * retried later and does not hold the reading back: it stays listed and, as a
 * danger row, raises the one-hour "not yet reached your care team" notice. Triage can
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
  // The subject is needed for the on-device history, but never worth waiting for: a slow or expired
  // session read must not hold back the emergency guidance (INV-06), so the check proceeds without it.
  let subjectId = await resolveSubject(beneficiaryProfileId);
  const triageInput: TriageInput = {
    systolic: plan.systolic,
    diastolic: plan.diastolic,
    redFlagTicked: plan.redFlagTicked,
    symptoms: plan.symptoms.map((x) => x.symptom_type),
    ...(subjectId ? { subjectId } : {}),
  };
  const outcome = await evaluate(triageInput).catch(() => fallbackOutcome(triageInput));
  onOutcome?.(outcome);

  // The engine's own plausibility check (spec 6.2): an implausible reading is never saved or graded. The form
  // already refuses these, so this only guards against the two lists drifting apart.
  if (outcome.device?.result.status === "rejected" && outcome.device.result.reason === "implausible_reading") {
    return { error: t("triage.tri_006.body", "en"), outcome };
  }

  if (!subjectId) {
    // The quick read gave up; the save itself may wait for the session (the guidance is already showing).
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
      payload: {
        vital_type: "blood_pressure",
        systolic: plan.systolic,
        diastolic: plan.diastolic,
        ...(plan.cuffType ? { cuff_type: plan.cuffType } : {}),
      },
      danger: outcome.bpFlag !== null || outcome.severity !== null,
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
