import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  confirmedRowsToReadings,
  diaryLimits,
  isLabelGuardRefusal,
  DIARY_GLUCOSE_CONTEXTS,
  type BpAckLevel,
  type Database,
  type DiaryDraftRow,
  type DiaryLimits,
  type DiaryProblem,
  type DiaryReading,
  type TablesInsert,
} from "@tarragon/shared";
import { assessBpControlBestEffort } from "@/lib/ml/assess-bp-control";
import { assessGlucoseBestEffort } from "@/lib/vitals/assess-glucose";
import { assessHeartRateBestEffort } from "@/lib/vitals/assess-heart-rate";
import { assessHealthScoreBestEffort } from "@/lib/health-score/assess-health-score";
import { readOutcome } from "@/lib/devices/reading-outcome";
import { classifyBpLevel } from "@/lib/rules/bp-classification";
import { derivedUuid } from "@/lib/vitals/derived-uuid";
import { runBestEffort } from "@/lib/sentry/run-best-effort";

/**
 * Saves the rows a person has CONFIRMED from their paper diary (S07y).
 *
 * THE SAME PATH AS A TYPED READING, NOT A SIDE DOOR. Each confirmed row becomes an ordinary `vitals_readings` insert with source "manual" and the label
 * entry_origin "paper_diary", so every trigger that fires for a typed reading fires for it: the plausibility hold, the blood pressure, pulse and glucose red-flag
 * engines and the emergency safety net, the observation.recorded event, the monitoring and risk bookkeeping. After the inserts the same best-effort assessments
 * run that logVital runs, and a failure of one is reported, never swallowed (CLAUDE.md: never silently swallow an abnormal result).
 *
 * The time is the person's stated time, kept by the database only inside the bounded window (offline_sync_config.diary_window_days, PROPOSED 30) and refused
 * outside it; this function re-validates every row with the same pure rules the screen used, so a hand-made request gets no further than the screen does.
 *
 * NOTHING HERE ASKS A MODEL ANYTHING. The assistant (AI-021) only ever suggested rows; by the time a row reaches this function it is the person's own
 * confirmed entry, and it is the deterministic triage that decides what it means.
 */

export const diaryRowSchema = z.object({
  /** A UUID the screen made when the row was created. It is the idempotency key: a retried save of the same row never doubles a reading. */
  key: z.string().uuid(),
  kind: z.enum(["blood_pressure", "glucose"]),
  date: z.string().max(10),
  time: z.string().max(5),
  systolic: z.string().max(4),
  diastolic: z.string().max(4),
  pulse: z.string().max(4),
  glucose: z.string().max(7),
  glucoseUnit: z.enum(["mmol_l", "mg_dl", ""]),
  glucoseContext: z.enum([...DIARY_GLUCOSE_CONTEXTS, ""]),
  suggested: z.boolean(),
  /** Only a row the person confirmed is accepted at all. */
  confirmed: z.literal(true),
});

export const diarySaveRequestSchema = z.object({
  rows: z.array(diaryRowSchema).min(1).max(50),
  /** Mobile only: the person whose account is open (a supporter with a live manage grant). */
  beneficiary_profile_id: z.string().uuid().optional(),
});
export type DiarySaveRequest = z.infer<typeof diarySaveRequestSchema>;

export type DiaryRowStatus =
  /** In the record, labelled "from your paper diary". */
  | "saved"
  /** This exact row was saved before (a retry). Counted as saved. */
  | "duplicate"
  /** A value that cannot be real was held for the person to check instead of being saved (the plausibility hold). */
  | "held"
  /** Linked to a reading already there from a better source (the cross-source de-duplication). */
  | "merged"
  /** Not saved, with the plain reasons. The row stays in the sheet. */
  | "refused"
  /** Not saved, for a reason that is nobody's fault (a dropped connection). The row stays in the sheet to try again. */
  | "failed";

export interface DiaryRowResult {
  key: string;
  status: DiaryRowStatus;
  problems?: DiaryProblem[];
  /** Set when the whole feature is closed for this person (guard off). */
  closed?: boolean;
}

export interface DiarySaveResult {
  results: DiaryRowResult[];
  /** The display band of the worst saved blood pressure row, so the screen shows the same signed wording a typed reading gets. "unknown" when a safety check did not finish. */
  bpAckLevel?: BpAckLevel;
  /** True when a saved reading could not be checked against the care protocols; the screen says so in words (never a plain "saved"). */
  safetyAssessmentFailed: boolean;
  tooMany?: boolean;
}

const BAND_ORDER: BpAckLevel[] = ["unknown", "green", "amber", "red", "emergency"];

/** A stable UUID for a second reading made from one row (the pulse), derived from the row's own id so a retry is a no-op. */
export function derivedDiaryClientId(key: string, label: string): string {
  return derivedUuid(`diary:${key}:${label}`);
}

function rowsFor(reading: DiaryReading, ctx: { subjectId: string; organisationId: string }): { part: string; row: TablesInsert<"vitals_readings"> }[] {
  const base = {
    patient_id: ctx.subjectId,
    organisation_id: ctx.organisationId,
    source: "manual" as const,
    entry_origin: "paper_diary" as const,
    client_recorded_at: reading.takenAt,
  };
  if (reading.vitalType === "blood_pressure") {
    const out: { part: string; row: TablesInsert<"vitals_readings"> }[] = [
      {
        part: "bp",
        row: { ...base, vital_type: "blood_pressure", systolic: reading.systolic ?? null, diastolic: reading.diastolic ?? null, client_reading_id: reading.key },
      },
    ];
    // The pulse is its own reading, exactly as the phone's quick-log saves it, so the pulse red-flag engine sees it like any other pulse.
    if (reading.pulseBpm !== undefined) {
      out.push({ part: "pulse", row: { ...base, vital_type: "pulse", pulse_bpm: reading.pulseBpm, client_reading_id: derivedDiaryClientId(reading.key, "pulse") } });
    }
    return out;
  }
  return [
    {
      part: "glucose",
      row: { ...base, vital_type: "glucose", glucose_mmol_l: reading.glucoseMmolL ?? null, glucose_context: reading.glucoseContext ?? null, client_reading_id: reading.key },
    },
  ];
}

export interface SaveDeps {
  /** The limits to judge the rows by; the handler passes the database's own window so the check here and the trigger can never disagree. */
  limits?: DiaryLimits;
  assessBp?: typeof assessBpControlBestEffort;
  assessPulse?: typeof assessHeartRateBestEffort;
  assessGlucose?: typeof assessGlucoseBestEffort;
  assessScore?: typeof assessHealthScoreBestEffort;
  now?: () => number;
}

export async function saveDiaryReadings(
  supabase: SupabaseClient<Database>,
  ctx: { subjectId: string; organisationId: string; route: string },
  rows: readonly DiaryDraftRow[],
  deps: SaveDeps = {}
): Promise<DiarySaveResult> {
  const assessBp = deps.assessBp ?? assessBpControlBestEffort;
  const assessPulse = deps.assessPulse ?? assessHeartRateBestEffort;
  const assessGlucose = deps.assessGlucose ?? assessGlucoseBestEffort;
  const assessScore = deps.assessScore ?? assessHealthScoreBestEffort;
  const nowMs = (deps.now ?? Date.now)();

  // The same pure rules the screen used: a hand-made request gets no further than the screen does.
  const checked = confirmedRowsToReadings(rows, nowMs, deps.limits ?? diaryLimits());
  if (checked.tooMany) return { results: [], safetyAssessmentFailed: false, tooMany: true };
  const results: DiaryRowResult[] = checked.blocked.map((b) => ({ key: b.key, status: "refused", problems: b.problems }));

  let savedBp = 0;
  let savedPulse = 0;
  let savedGlucose = 0;
  let worst: BpAckLevel | undefined;
  let closed = false;

  const countStored = (part: string, reading: DiaryReading) => {
    if (part === "bp") {
      savedBp += 1;
      const level = classifyBpLevel(reading.systolic, reading.diastolic);
      if (worst === undefined || BAND_ORDER.indexOf(level) > BAND_ORDER.indexOf(worst)) worst = level;
    } else if (part === "pulse") savedPulse += 1;
    else savedGlucose += 1;
  };

  for (const reading of checked.readings) {
    if (closed) {
      results.push({ key: reading.key, status: "refused", closed: true });
      continue;
    }
    let refusedProblems: DiaryProblem[] | undefined;
    let failure: "refused" | "failed" | null = null;
    // What became of each part of the row (a blood pressure row with a pulse has two). EVERY part is tried: a part linked to a reading already there, or held,
    // must never stop a dangerous pulse next to it from reaching the pulse red-flag engine.
    const parts: ("stored" | "repeat" | "held" | "merged")[] = [];
    for (const { part, row } of rowsFor(reading, ctx)) {
      const { data, error } = await supabase.from("vitals_readings").insert(row).select("id");
      if (error) {
        if (error.code === "23505") {
          // This exact row was saved before: a retry. It is counted for the safety assessments and the wording below, never skipped: when the first answer was
          // lost, this is the only place a person is told what a dangerous value means, and the post-insert checks may not have run the first time (they are
          // safe to run twice). The database triggers already fired when the row was first stored.
          parts.push("repeat");
          countStored(part, reading);
          continue;
        }
        if (isLabelGuardRefusal(error)) {
          // the diary's guard is closed for this person: nothing was saved, and nothing else will be tried
          closed = true;
          break;
        }
        failure = error.code === "22023" || error.code === "23514" ? "refused" : "failed";
        // The screen and this function both judged the date first, so a 22023 here means the database's own window is narrower than the configured one
        // (the two are mirrored by a test, but a new version of one without the other would show up as this): say the date was not accepted, in words.
        if (error.code === "22023") refusedProblems = ["date_invalid"];
        break;
      }
      // The insert can succeed and store nothing: an impossible value is held, a duplicate from a better source is linked. Neither is "saved". Only an empty
      // answer needs the extra look, so the usual save is one round trip per reading.
      if (Array.isArray(data) && data.length > 0) {
        parts.push("stored");
        countStored(part, reading);
        continue;
      }
      const outcome = await readOutcome(supabase, { patientId: ctx.subjectId, clientReadingId: row.client_reading_id ?? undefined });
      if (outcome.kind === "held") parts.push("held");
      else if (outcome.kind === "merged") parts.push("merged");
      else if (outcome.kind === "saved") {
        parts.push("stored");
        countStored(part, reading);
      } else {
        // not known to be in the record: it stays on the sheet to be tried again (the row ids make that safe)
        failure = "failed";
        break;
      }
    }
    if (closed) {
      results.push({ key: reading.key, status: "refused", closed: true });
      continue;
    }
    if (failure) {
      results.push({ key: reading.key, status: failure, ...(refusedProblems ? { problems: refusedProblems } : {}) });
      continue;
    }
    // One answer for the row: held if any part was held (the person has a number to check), saved if anything was stored, a duplicate if everything was a repeat,
    // and merged only when EVERY part matched a reading already there.
    const status: DiaryRowStatus = parts.includes("held")
      ? "held"
      : parts.every((x) => x === "repeat")
        ? "duplicate"
        : parts.some((x) => x === "stored" || x === "repeat")
          ? "saved"
          : "merged";
    results.push({ key: reading.key, status });
  }

  // The same post-insert safety assessments as a typed reading, once per kind (each reads the person's whole recent history).
  const extra = (stage: string) => ({ route: ctx.route, stage, patientId: ctx.subjectId, organisationId: ctx.organisationId });
  let safetyAssessmentFailed = false;
  if (savedBp > 0) safetyAssessmentFailed = (await runBestEffort(() => assessBp(supabase, ctx.subjectId, ctx.organisationId), extra("safety_assessment_bp"))) || safetyAssessmentFailed;
  if (savedPulse > 0) safetyAssessmentFailed = (await runBestEffort(() => assessPulse(supabase, ctx.subjectId, ctx.organisationId), extra("safety_assessment_pulse"))) || safetyAssessmentFailed;
  if (savedGlucose > 0) safetyAssessmentFailed = (await runBestEffort(() => assessGlucose(supabase, ctx.subjectId, ctx.organisationId), extra("safety_assessment_glucose"))) || safetyAssessmentFailed;  // band-ok: a count of rows saved compared with zero, not a clinical threshold
  // Genuinely inert bookkeeping: a lost health-score refresh has no clinical-safety consequence.
  if (savedBp + savedPulse + savedGlucose > 0) await runBestEffort(() => assessScore(supabase, ctx.subjectId, ctx.organisationId), extra("post_insert_best_effort"));  // band-ok: a count of rows saved compared with zero, not a clinical threshold

  const bpAckLevel: BpAckLevel | undefined = savedBp > 0 ? (safetyAssessmentFailed ? "unknown" : worst) : undefined;
  return { results, ...(bpAckLevel ? { bpAckLevel } : {}), safetyAssessmentFailed };
}
