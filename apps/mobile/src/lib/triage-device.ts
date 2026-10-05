import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BP_CARE_V1,
  grade,
  messageKeyFor,
  validateRuleSet,
  type Reading,
  type RuleSet,
  type SymptomCode,
  type TriageInput,
  type TriageResult,
} from "@tarragon/clinical";
import type { VitalReadingPayload } from "./api";
import { loadTriageWiringConfig } from "./triage-config";
import { readCachedBpTarget } from "./bp-target";
import { readLocalRecords } from "./offline-store";
import { listOutbox } from "./outbox";
import { supabase } from "./supabase";

/**
 * On-device triage (S12, spec 6.1 and INV-06). The phone runs the same pure engine as the server
 * (@tarragon/clinical) over the rule set bundled in the app, or the approved one it last cached, so a
 * red reading shows emergency guidance with no network at all. No language model is ever called here
 * (INV-01). This module never writes anything to the server: the reading is saved by the outbox and the
 * server grades it again as the authority.
 *
 * Nothing here may make the patient wait. Everything it reads is local (the mirror, the outbox, the
 * cached target), and the whole context load is cut off after CONTEXT_BUDGET_MS: the red rules need
 * only the reading and the ticked symptoms, so a slow phone falls back to those and still answers.
 *
 * Until the Chief Medical Officer approves a rule set, the bundled one is a DRAFT (OQ-88): the caller
 * keeps showing what the older on-device check shows and uses this result only to add to it.
 */
export const TRIAGE_RULE_SET_CODE = "bp_care_triage";
export const CONTEXT_BUDGET_MS = 600;
const RULES_KEY = "@tarragon/triage/rules/v1";
const CHECKED_KEY = "@tarragon/triage/rules-checked/v1";
const FACTS_KEY = (subjectId: string) => `@tarragon/triage/facts/v1:${subjectId}`;
const RECHECK_KEY = (subjectId: string) => `@tarragon/triage/pending-recheck/v1:${subjectId}`;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const FALLBACK_TARGET = { systolic: 135, diastolic: 85 } as const;

/** Placeholder until the audio session (S32) records the clips: the manifest swaps this prefix for a real clip id. */
export const AUDIO_PLACEHOLDER_PREFIX = "audio-pending:";
export const triageAudioId = (code: string | null): string | null => (code === null ? null : `${AUDIO_PLACEHOLDER_PREFIX}${code}`);

export interface DeviceRuleSet {
  ruleSet: RuleSet;
  status: "approved" | "draft";
}

export interface DeviceTriage {
  result: TriageResult;
  /** "emergency" when the result asks for the emergency guidance (a red result, or a red-flag symptom). */
  severity: "emergency" | null;
  /** EMG-001 or EMG-001L when guidance is asked for. */
  emergencyCode: string | null;
  /** Catalogue keys (@tarragon/i18n) for the message to show, if the result has one. */
  message: { title: string; body: string } | null;
  /** Placeholder clip id for the message (the real clips arrive in S32). */
  audioId: string | null;
  ruleSet: { code: string; version: number; status: "approved" | "draft" };
}

export interface PendingRecheck {
  reading: Reading;
}

export interface DeviceTriageRequest {
  subjectId: string;
  /** The signed-in account, used to find the cached target; defaults to the subject. */
  userId?: string;
  systolic: number;
  diastolic: number;
  symptoms: readonly SymptomCode[];
  nowMs?: number;
}

async function markChecked(nowMs: number = Date.now()): Promise<void> {
  await AsyncStorage.setItem(CHECKED_KEY, String(nowMs)).catch(() => {});
}

/**
 * Whether the phone's triage guidance may be out of date (S12b): true when it has never reached the server to ask
 * for the approved rule set, or last did more than `staleAfterDays` ago. Only a warning: the guidance itself is never
 * switched off, because stale emergency guidance still beats none (INV-06).
 */
export async function rulesMayBeStale(nowMs: number = Date.now()): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(CHECKED_KEY);
    const at = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(at)) return true;
    return nowMs - at > loadTriageWiringConfig().staleAfterDays * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

/** The approved rule set last cached on this phone, if it is still valid; otherwise the bundled draft. */
export async function loadDeviceRuleSet(): Promise<DeviceRuleSet> {
  try {
    const raw = await AsyncStorage.getItem(RULES_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as unknown;
      if (validateRuleSet(cached).length === 0 && (cached as RuleSet).code === TRIAGE_RULE_SET_CODE) {
        return { ruleSet: cached as RuleSet, status: "approved" };
      }
    }
  } catch {
    // fall through to the bundled copy
  }
  return { ruleSet: BP_CARE_V1, status: "draft" };
}

/**
 * Best effort, online only: keep the phone's copy in step with the approved rule set. A set that fails
 * validation is never stored; when nothing is approved any old cached copy is dropped so the phone does
 * not keep acting on a set the care team has since retired.
 */
export async function refreshApprovedRuleSet(): Promise<"updated" | "none_approved" | "unchanged" | "failed"> {
  try {
    const { data, error } = await supabase.rpc("get_approved_triage_rule_set", { p_code: TRIAGE_RULE_SET_CODE });
    if (error) return "failed";
    const row = data as { rules?: unknown } | null;
    if (!row || !row.rules) {
      await AsyncStorage.removeItem(RULES_KEY);
      await markChecked();
      return "none_approved";
    }
    if (validateRuleSet(row.rules).length > 0) return "failed";
    const next = JSON.stringify(row.rules);
    if ((await AsyncStorage.getItem(RULES_KEY)) === next) {
      await markChecked();
      return "unchanged";
    }
    await AsyncStorage.setItem(RULES_KEY, next);
    await markChecked();
    return "updated";
  } catch {
    return "failed";
  }
}

type LocalVital = { id?: string; vital_type?: string; systolic?: number | null; diastolic?: number | null; taken_at?: string; client_reading_id?: string | null };

/** Blood pressure readings of the last 14 days from this phone only: the mirror plus readings not yet sent. */
export async function localBpHistory(subjectId: string, nowMs: number): Promise<Reading[]> {
  const since = nowMs - FOURTEEN_DAYS_MS;
  const out = new Map<string, Reading>();
  const synced = await readLocalRecords<LocalVital>("vital", subjectId, 200).catch(() => [] as LocalVital[]);
  for (const r of synced) {
    if (r.vital_type !== "blood_pressure" || typeof r.systolic !== "number" || typeof r.diastolic !== "number" || !r.taken_at) continue;
    const ms = Date.parse(r.taken_at);
    if (Number.isFinite(ms) && ms >= since && ms <= nowMs) out.set(r.client_reading_id ?? r.id ?? r.taken_at, { systolic: r.systolic, diastolic: r.diastolic, takenAt: r.taken_at });
  }
  const queued = await listOutbox("vital").catch(() => []);
  for (const q of queued) {
    const payload = q.payload as VitalReadingPayload;
    if (q.state !== "pending" || q.subjectId !== subjectId || payload.vital_type !== "blood_pressure") continue;
    const ms = Date.parse(q.clientRecordedAt);
    if (Number.isFinite(ms) && ms >= since && ms <= nowMs) out.set(q.clientId, { systolic: payload.systolic, diastolic: payload.diastolic, takenAt: q.clientRecordedAt });
  }
  return [...out.values()].sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

interface PatientFacts {
  /** YYYY-MM-DD, or null when none is on file. */
  dateOfBirth: string | null;
  pregnant: boolean;
}

/** Whole years on `nowMs`, or null when the date is missing or not a real date. */
export function ageYearsOn(dateOfBirth: string | null, nowMs: number): number | null {
  if (!dateOfBirth) return null;
  const dob = Date.parse(`${dateOfBirth}T00:00:00Z`);
  if (!Number.isFinite(dob) || dob > nowMs) return null;
  const a = new Date(dob);
  const n = new Date(nowMs);
  let years = n.getUTCFullYear() - a.getUTCFullYear();
  if (n.getUTCMonth() < a.getUTCMonth() || (n.getUTCMonth() === a.getUTCMonth() && n.getUTCDate() < a.getUTCDate())) years -= 1;
  return years;
}

async function readFacts(subjectId: string): Promise<PatientFacts> {
  try {
    const raw = await AsyncStorage.getItem(FACTS_KEY(subjectId));
    if (raw) {
      const v = JSON.parse(raw) as Partial<PatientFacts>;
      return { dateOfBirth: typeof v.dateOfBirth === "string" ? v.dateOfBirth : null, pregnant: v.pregnant === true };
    }
  } catch {
    // fall through
  }
  return { dateOfBirth: null, pregnant: false };
}

/**
 * Best effort, online only (OQ-90): keep the date of birth and pregnancy flag the server grades with on the phone, so the
 * phone routes a pregnant or under-18 patient to the care team the same way (BP-P1, BP-P2) instead of grading on adult
 * bands. A failed read keeps the last copy; a read that works but finds nothing stores that, so a corrected record is not stale.
 */
export async function refreshPatientFacts(subjectId: string): Promise<"updated" | "failed"> {
  if (!subjectId) return "failed";
  try {
    const [profile, pregnancy] = await Promise.all([
      supabase.from("profiles").select("date_of_birth").eq("id", subjectId).maybeSingle(),
      supabase.from("patient_pregnancy").select("is_pregnant").eq("patient_id", subjectId).maybeSingle(),
    ]);
    if (profile.error || pregnancy.error) return "failed";
    const facts: PatientFacts = { dateOfBirth: profile.data?.date_of_birth ?? null, pregnant: pregnancy.data?.is_pregnant === true };
    await AsyncStorage.setItem(FACTS_KEY(subjectId), JSON.stringify(facts));
    return "updated";
  } catch {
    return "failed";
  }
}

export async function readPendingRecheck(subjectId: string): Promise<PendingRecheck | null> {
  try {
    const raw = await AsyncStorage.getItem(RECHECK_KEY(subjectId));
    if (!raw) return null;
    const v = JSON.parse(raw) as { reading?: Reading };
    const r = v.reading;
    return r && typeof r.systolic === "number" && typeof r.diastolic === "number" && Number.isFinite(Date.parse(r.takenAt)) ? { reading: r } : null;
  } catch {
    return null;
  }
}
async function savePendingRecheck(subjectId: string, reading: Reading): Promise<void> {
  await AsyncStorage.setItem(RECHECK_KEY(subjectId), JSON.stringify({ reading })).catch(() => {});
}
export async function clearPendingRecheck(subjectId: string): Promise<void> {
  await AsyncStorage.removeItem(RECHECK_KEY(subjectId)).catch(() => {});
}

function summarise(result: TriageResult, rules: DeviceRuleSet): DeviceTriage {
  const guidance = result.actions.find((a) => a.kind === "show_emergency_guidance");
  const emergencyCode = guidance && guidance.kind === "show_emergency_guidance" ? guidance.code : null;
  // A rejected reading with a red-flag symptom still shows the guidance (the engine sets the flag, no code), so fall back to the standard code.
  const code = emergencyCode ?? (result.status === "rejected" && result.redFlagSymptomPresent ? "EMG-001" : null);
  const messageCode = code ?? result.explanationKey;
  return {
    result,
    severity: code ? "emergency" : null,
    emergencyCode: code,
    message: messageKeyFor(messageCode),
    audioId: triageAudioId(messageCode),
    ruleSet: { code: result.ruleSet.code, version: result.ruleSet.version, status: rules.status },
  };
}

async function withBudget<T>(work: Promise<T>, fallback: T, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cut = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work, cut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface Context {
  history: Reading[];
  target: { systolic: number; diastolic: number };
  pending: PendingRecheck | null;
  facts: PatientFacts;
  rules: DeviceRuleSet;
}

async function loadContext(subjectId: string, userId: string, nowMs: number): Promise<Omit<Context, "rules">> {
  const [history, target, pending, facts] = await Promise.all([
    localBpHistory(subjectId, nowMs).catch(() => []),
    readCachedBpTarget(userId, subjectId).catch(() => null),
    readPendingRecheck(subjectId),
    readFacts(subjectId),
  ]);
  return {
    history,
    target: target ? { systolic: target.systolicBelow, diastolic: target.diastolicBelow } : { ...FALLBACK_TARGET },
    pending,
    facts,
  };
}

/**
 * Grade one reading on the phone. Never throws and never waits longer than CONTEXT_BUDGET_MS for context:
 * the fallback context (no history, the standard target, no pending repeat) still grades every red rule.
 */
export async function gradeOnDevice(req: DeviceTriageRequest): Promise<DeviceTriage> {
  const nowMs = req.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  // Both reads start together so the worst case is one budget, not two: a red result must show in under a second (INV-06).
  const [rules, ctx] = await Promise.all([
    withBudget(loadDeviceRuleSet(), { ruleSet: BP_CARE_V1, status: "draft" as const }, CONTEXT_BUDGET_MS),
    withBudget<Omit<Context, "rules">>(
      loadContext(req.subjectId, req.userId ?? req.subjectId, nowMs),
      { history: [], target: { ...FALLBACK_TARGET }, pending: null, facts: { dateOfBirth: null, pregnant: false } },
      CONTEXT_BUDGET_MS,
    ),
  ]);

  const reading: Reading = { systolic: req.systolic, diastolic: req.diastolic, takenAt: now };
  const windowMinutes = rules.ruleSet.params.recheck.windowMinutes;
  const waited = ctx.pending ? (nowMs - Date.parse(ctx.pending.reading.takenAt)) / 60_000 : null;
  const recheck =
    ctx.pending && waited !== null && waited >= 0 && waited <= windowMinutes
      ? ({ kind: "repeat", previous: ctx.pending.reading, minutesSincePrevious: Math.round(waited * 100) / 100 } as const)
      : undefined;

  const input: TriageInput = {
    trigger: { type: "observation", reading, symptoms: req.symptoms, ...(recheck ? { recheck } : {}) },
    history: ctx.history,
    target: ctx.target,
    pathway: { state: "self_guided" },
    pregnant: ctx.facts.pregnant,
    ageYears: ageYearsOn(ctx.facts.dateOfBirth, nowMs),
    now,
  };
  const result = grade(input, rules.ruleSet);
  const triage = summarise(result, rules);

  // With no subject (the session could not be read in time) nothing is stored: a shared empty key would pair unrelated readings.
  if (req.subjectId) {
    if (result.status === "recheck_required") await savePendingRecheck(req.subjectId, reading);
    else if (result.status === "graded") await clearPendingRecheck(req.subjectId);
  }
  return triage;
}

/**
 * A first elevated reading whose repeat never came: after the window, grade it as if repeated (spec 6.2).
 * Called when the vitals screen opens. The server does the same on its own clock; this is the phone's copy
 * of the answer, so the patient sees it even if they never open the app until later.
 */
export async function resolveExpiredRecheck(subjectId: string, nowMs: number = Date.now()): Promise<DeviceTriage | null> {
  const pending = await readPendingRecheck(subjectId);
  if (!pending) return null;
  const rules = await loadDeviceRuleSet();
  const waited = (nowMs - Date.parse(pending.reading.takenAt)) / 60_000;
  if (waited <= rules.ruleSet.params.recheck.windowMinutes) return null;
  const ctx = await loadContext(subjectId, subjectId, nowMs);
  const result = grade(
    {
      trigger: { type: "observation", reading: pending.reading, symptoms: [], recheck: { kind: "timed_out" } },
      history: ctx.history.filter((h) => h.takenAt !== pending.reading.takenAt),
      target: ctx.target,
      pathway: { state: "self_guided" },
      pregnant: ctx.facts.pregnant,
      ageYears: ageYearsOn(ctx.facts.dateOfBirth, nowMs),
      now: new Date(nowMs).toISOString(),
    },
    rules.ruleSet,
  );
  await clearPendingRecheck(subjectId);
  return summarise(result, rules);
}
