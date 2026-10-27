import {
  evaluateContractions,
  evaluateKickSession,
  kickCounterAvailable,
  personalNormalMinutes,
  type BirthPlanFlags,
  type Contraction,
  type ContractionEvaluation,
  type FinishedKickSession,
  type InstantGoSign,
  type KickEvaluation,
} from "@tarragon/clinical";
import { loadMaternalConfig } from "./maternal-config";
import { localGet, localSet } from "./pregnancy-local";
import { readPregnancyWeek } from "./obstetric-status";
import { enqueue } from "./outbox";
import type { ContractionSessionPayload, KickSessionPayload } from "./pregnancy-payloads";

/**
 * The pregnancy tools on the phone (S67, spec 16.7): the baby movement counter and the contraction timer. Everything is decided
 * here, on the device, from the PROPOSED `maternal.rules` config, so the card shows with no signal (INV-06); the finished session
 * is then written to the one offline outbox and synced like a reading. A "contact your care team today" or "go now" result is
 * queued as DANGER, so a session that has not reached the server raises the same "not yet reached your care team" notice a red
 * reading does. No language model is called anywhere here (INV-01), and nothing here ever tells anyone to wait.
 */
// The history is in the encrypted store (pregnancy-local); the old plain AsyncStorage key is read once and moved across.
const LEGACY_HISTORY_KEY = (subjectId: string) => `@tarragon/kick-history/v1:${subjectId}`;
const HISTORY_KEY = (subjectId: string) => `kick-history:${subjectId}`;

/**
 * The week the screen is showing. When a caller passes it, it is used instead of the copy cached with the obstetric status, so the screen
 * and the cards can never disagree about the week. `undefined` means "not passed": fall back to the cache.
 */
async function weekFor(subjectId: string, nowMs: number, passed: number | null | undefined): Promise<number | null> {
  return passed !== undefined ? passed : readPregnancyWeek(subjectId, nowMs);
}
const MAX_HISTORY = 12;

async function readKickHistory(subjectId: string): Promise<FinishedKickSession[]> {
  try {
    const raw = await localGet(HISTORY_KEY(subjectId), LEGACY_HISTORY_KEY(subjectId));
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(v)) return [];
    return v
      .map((x) => ({ minutesToTarget: typeof (x as { m?: unknown }).m === "number" ? (x as { m: number }).m : null }))
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

async function writeKickHistory(subjectId: string, history: readonly FinishedKickSession[]): Promise<void> {
  const compact = history.slice(-MAX_HISTORY).map((h) => ({ m: h.minutesToTarget }));
  await localSet(HISTORY_KEY(subjectId), JSON.stringify(compact)).catch(() => {});
}

export interface KickSessionInput {
  subjectId: string;
  organisationId: string;
  startedAtMs: number;
  /** Times (ms) of each tapped movement. */
  movementMs: readonly number[];
  reportedLess?: boolean;
  nowMs: number;
  /** The week the screen shows (null when unknown). Omit to use the cached one. */
  week?: number | null;
}

/** What a screen needs while counting: the live evaluation, with her personal normal if she has one. Pure over the cached history. */
export async function evaluateKickNow(input: Omit<KickSessionInput, "organisationId">): Promise<KickEvaluation> {
  const { config } = loadMaternalConfig();
  const normal = personalNormalMinutes(await readKickHistory(input.subjectId), config);
  return evaluateKickSession(
    { startedAtMs: input.startedAtMs, movementMs: input.movementMs, reportedLess: input.reportedLess },
    input.nowMs,
    normal,
    config,
  );
}

/**
 * Whether the counter is offered. A week the screen passes as unknown (null) is offered: the counter and its contact-today card must
 * never be hidden behind "not yet" because the dating is missing. With no week passed at all, the cached week decides, as before.
 */
export async function kickCounterOffered(subjectId: string, nowMs: number, week?: number | null): Promise<boolean> {
  const { config } = loadMaternalConfig();
  if (week === null) return true;
  return kickCounterAvailable(await weekFor(subjectId, nowMs, week), config);
}

/** Ends a counting session: evaluates it once more, writes it to the outbox and remembers how long it took. */
export async function finishKickSession(input: KickSessionInput): Promise<KickEvaluation> {
  const { config, version } = loadMaternalConfig();
  const history = await readKickHistory(input.subjectId);
  const evaluation = evaluateKickSession(
    { startedAtMs: input.startedAtMs, movementMs: input.movementMs, reportedLess: input.reportedLess },
    input.nowMs,
    personalNormalMinutes(history, config),
    config,
  );
  const week = await weekFor(input.subjectId, input.nowMs, input.week);
  const result: KickSessionPayload["result"] = evaluation.state === "counting" ? "stopped" : evaluation.state;
  const payload: KickSessionPayload = {
    started_at: new Date(input.startedAtMs).toISOString(),
    ended_at: new Date(input.nowMs).toISOString(),
    movement_offsets_s: input.movementMs.map((t) => Math.max(0, Math.round((t - input.startedAtMs) / 1000))).slice(0, 200),
    reported_less: input.reportedLess === true,
    result,
    result_reason: result === "contact_today" ? evaluation.reason : null,
    minutes_to_target: evaluation.minutesToTarget === null ? null : Math.round(evaluation.minutesToTarget * 100) / 100,
    week_at_start: week,
    config_version: version,
    organisation_id: input.organisationId,
  };
  await enqueue({
    kind: "kick_session",
    subjectId: input.subjectId,
    payload,
    danger: result === "contact_today",
    recordedAt: payload.started_at,
  });
  // A session she stopped early says nothing about her normal; only finished ones count.
  if (result !== "stopped") await writeKickHistory(input.subjectId, [...history, { minutesToTarget: evaluation.minutesToTarget }]);
  return evaluation;
}

export interface ContractionSessionInput {
  subjectId: string;
  organisationId: string;
  startedAtMs: number;
  contractions: readonly Contraction[];
  signs: readonly InstantGoSign[];
  flags: BirthPlanFlags | null;
  nowMs: number;
  /** The week the screen shows (null when unknown). Omit to use the cached one. */
  week?: number | null;
  /**
   * A "go now" answer the screen already showed and kept. Saved as it is instead of being worked out again: once the next contraction
   * starts the live rule no longer counts the run, and a later save must not turn a shown go-now card into "keep timing".
   */
  known?: ContractionEvaluation;
}

export async function evaluateContractionsNow(input: Omit<ContractionSessionInput, "organisationId" | "startedAtMs">): Promise<ContractionEvaluation> {
  const { config } = loadMaternalConfig();
  const week = await weekFor(input.subjectId, input.nowMs, input.week);
  return evaluateContractions(input.contractions, { week, signs: input.signs, flags: input.flags }, input.nowMs, config);
}

/** Ends a timing session and queues it. A go-now result is queued as danger. */
export async function finishContractionSession(input: ContractionSessionInput): Promise<ContractionEvaluation> {
  const { config, version } = loadMaternalConfig();
  const week = await weekFor(input.subjectId, input.nowMs, input.week);
  const evaluation = input.known ?? evaluateContractions(input.contractions, { week, signs: input.signs, flags: input.flags }, input.nowMs, config);
  const payload: ContractionSessionPayload = {
    started_at: new Date(input.startedAtMs).toISOString(),
    timings: input.contractions
      .map((c) => ({ s: Math.max(0, Math.round((c.startMs - input.startedAtMs) / 1000)), d: Math.max(0, Math.round(((c.endMs ?? input.nowMs) - c.startMs) / 1000)) }))
      .slice(0, 300),
    instant_signs: [...input.signs],
    pattern: evaluation.pattern,
    result: evaluation.state,
    result_reason: evaluation.state === "go_now" ? evaluation.reason : null,
    week_at_start: week,
    config_version: version,
    organisation_id: input.organisationId,
  };
  await enqueue({ kind: "contraction_session", subjectId: input.subjectId, payload, danger: evaluation.state === "go_now", recordedAt: payload.started_at });
  return evaluation;
}
