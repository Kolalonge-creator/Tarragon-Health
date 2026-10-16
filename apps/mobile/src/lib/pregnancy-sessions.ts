import AsyncStorage from "@react-native-async-storage/async-storage";
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
const HISTORY_KEY = (subjectId: string) => `@tarragon/kick-history/v1:${subjectId}`;
const MAX_HISTORY = 12;

async function readKickHistory(subjectId: string): Promise<FinishedKickSession[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY(subjectId));
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
  await AsyncStorage.setItem(HISTORY_KEY(subjectId), JSON.stringify(compact)).catch(() => {});
}

export interface KickSessionInput {
  subjectId: string;
  organisationId: string;
  startedAtMs: number;
  /** Times (ms) of each tapped movement. */
  movementMs: readonly number[];
  reportedLess?: boolean;
  nowMs: number;
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

export async function kickCounterOffered(subjectId: string, nowMs: number): Promise<boolean> {
  const { config } = loadMaternalConfig();
  return kickCounterAvailable(await readPregnancyWeek(subjectId, nowMs), config);
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
  const week = await readPregnancyWeek(input.subjectId, input.nowMs);
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
}

export async function evaluateContractionsNow(input: Omit<ContractionSessionInput, "organisationId" | "startedAtMs">): Promise<ContractionEvaluation> {
  const { config } = loadMaternalConfig();
  const week = await readPregnancyWeek(input.subjectId, input.nowMs);
  return evaluateContractions(input.contractions, { week, signs: input.signs, flags: input.flags }, input.nowMs, config);
}

/** Ends a timing session and queues it. A go-now result is queued as danger. */
export async function finishContractionSession(input: ContractionSessionInput): Promise<ContractionEvaluation> {
  const { config, version } = loadMaternalConfig();
  const week = await readPregnancyWeek(input.subjectId, input.nowMs);
  const evaluation = evaluateContractions(input.contractions, { week, signs: input.signs, flags: input.flags }, input.nowMs, config);
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
