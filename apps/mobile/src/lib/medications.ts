import {
  computeWeeklyAdherence,
  estimateSupply,
  isRunningLow,
  lagosLocalDate,
  lagosTimeToUtcMs,
  parseScheduleSpec,
  slotState,
  slotsOn,
  specFromLegacyTimes,
  takenStatus,
  addDays,
  allTimes,
  groupLogsBySlot,
  type AdherenceResult,
  type DoseLog,
  type FoodNote,
  type LogStatus,
  type ScheduleSpec,
  type SlotState,
  type SupplyEstimate,
} from "@tarragon/medicines";
import { enqueue, flushOutbox, listOutbox, removePendingRow, type DosePayload } from "./outbox";
import { loadReminderBehaviour } from "./s07-config";
import { loadAdherenceBand, loadMedicineRules } from "./medicines-config";
import { pullChangesThrottled, readLocalMedications, readLocalRecords } from "./offline-store";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./api";
import type { Json, Tables } from "@tarragon/shared";

/**
 * Shared result shape for the native read-path lib functions (overview.ts
 * imports it from here). A failed clinical query must be distinguishable
 * from a genuinely empty one — destructuring `{ data }` and discarding the
 * error made an RLS denial or a network drop render as "Active meds 0" /
 * "No scheduled doses today", which is a false clinical claim, not a UI nit.
 */
export type QueryResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type DoseStatus = "pending" | "taken" | "missed" | "skipped";

/** Where a medicine came from: written by the care team, or added by the patient (INV-02: only the latter is theirs to change). */
export type DoseOrigin = "prescription" | "patient_added";

export interface DoseChecklistItem {
  medicationId: string;
  drugName: string;
  time: string;
  /** The older three-way status other screens read. "taken late" reads as taken; "could not get it" as skipped. */
  status: DoseStatus;
  /** S08: when the dose is due, the full state, what a taper step says to take, and the food note. */
  dueAtMs?: number;
  state?: SlotState;
  doseText?: string | null;
  foodNote?: FoodNote | null;
  origin?: DoseOrigin;
  /** The Lagos date of the slot. A screen left open past midnight must log against this, not against "today". */
  date?: string;
  /** The strength and dose the medicine record carries, shown as read-only text. */
  doseLabel?: string | null;
}

type MedicationForChecklist = Pick<Tables<"medications">, "id" | "drug_name" | "schedule_times"> & {
  schedule_spec?: unknown;
  source?: string | null;
  created_at?: string | null;
  /** Stamped when the schedule is edited, so a newly added time owes nothing from before the edit. */
  schedule_effective_from?: string | null;
  dose?: string | null;
};

/** When a medicine's current schedule began to apply: the later of when it was added and when its times last changed. */
export function activeFromMs(m: { created_at?: string | null; schedule_effective_from?: string | null }): number {
  const created = m.created_at ? Date.parse(m.created_at) : 0;
  const edited = m.schedule_effective_from ? Date.parse(m.schedule_effective_from) : 0;
  return Math.max(Number.isFinite(created) ? created : 0, Number.isFinite(edited) ? edited : 0);
}
// Sourced from medication_logs_latest_per_slot (20261004214531), not the raw
// append-only table: it keeps one row per slot and lets a row a person wrote beat
// the server's own "missed". A view's columns are nullable regardless of the
// underlying column, hence the broader types here versus medication_logs'.
type LogForChecklist = Pick<
  Tables<"medication_logs_latest_per_slot">,
  "medication_id" | "scheduled_time" | "status"
>;

/** The schedule a medicine row carries: the structured spec when it parses, otherwise the old plain list of daily times. */
export function scheduleOf(medication: { schedule_times: unknown; schedule_spec?: unknown }): ScheduleSpec {
  if (medication.schedule_spec !== null && medication.schedule_spec !== undefined) {
    const parsed = parseScheduleSpec(medication.schedule_spec);
    if (parsed.ok) return parsed.spec;
  }
  return specFromLegacyTimes(medication.schedule_times);
}

function legacyStatus(logStatus: string | undefined): DoseStatus {
  if (logStatus === "taken" || logStatus === "delayed") return "taken";
  if (logStatus === "skipped" || logStatus === "not_available") return "skipped";
  if (logStatus === "missed") return "missed";
  return "pending";
}

/** Mirrors apps/web/src/lib/medication-schedule/checklist.ts's buildTodaysDoseChecklist for
 * plain daily times, and adds the structured schedules (every few days, certain weekdays,
 * step-down) and the dose state. Duplicated rather than imported since apps/web isn't a
 * shared package the mobile app can pull from; keep the two in sync for daily times. */
export function buildTodaysDoseChecklist(
  medications: MedicationForChecklist[],
  logs: LogForChecklist[],
  nowMs: number = Date.now()
): DoseChecklistItem[] {
  const today = lagosLocalDate(nowMs);
  const { missedAfterMinutes } = loadReminderBehaviour();
  const items: DoseChecklistItem[] = [];
  for (const medication of medications) {
    const startedAtMs = activeFromMs(medication);
    const spec = scheduleOf(medication);
    for (const slot of slotsOn(spec, today)) {
      const dueAtMs = lagosTimeToUtcMs(slot.date, slot.time);
      // A medicine added at noon owes no 08:00 dose that morning, and a time added by an edit owes nothing from before it.
      if (dueAtMs < startedAtMs) continue;
      const log = logs.find((l) => l.medication_id === medication.id && l.scheduled_time === slot.time);
      const doseLogs: DoseLog[] = log?.status
        ? [{ status: log.status as LogStatus, source: "patient", loggedAtMs: nowMs }]
        : [];
      items.push({
        medicationId: medication.id,
        drugName: medication.drug_name,
        time: slot.time,
        status: legacyStatus(log?.status ?? undefined),
        dueAtMs,
        state: slotState(dueAtMs, doseLogs, nowMs, missedAfterMinutes),
        doseText: slot.doseText,
        foodNote: spec.foodNote,
        origin: medication.source === "clinician" ? "prescription" : "patient_added",
        date: slot.date,
        doseLabel: medication.dose ?? null,
      });
    }
  }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}

/** Patient-local (Africa/Lagos) calendar date, per CLAUDE.md's fixed timezone rule. */
export function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

/**
 * medication_logs is append-only (20260830224528): a slot can carry more
 * than one row once a dose is corrected. medication_logs_latest_per_slot
 * keeps only the latest row per (medication, date, time) — freeform/
 * as-needed logs (no scheduled slot) are never deduped, each stands alone.
 */
export async function loadTodaysDoses(patientId: string): Promise<QueryResult<DoseChecklistItem[]>> {
  const today = todayIsoDate();
  // Doses logged on this phone and not yet sent. Listed first so they win over
  // an older server row for the same slot (buildTodaysDoseChecklist takes the first match).
  const pendingLogs = async (): Promise<LogForChecklist[]> =>
    (await listOutbox("dose"))
      .filter((r) => r.subjectId === patientId && (r.payload as DosePayload).scheduled_for_date === today)
      .map((r) => {
        const p = r.payload as DosePayload;
        return { medication_id: p.medication_id, scheduled_time: p.scheduled_time, status: p.status as never };
      })
      .reverse();
  try {
    const [medsRes, logsRes] = await Promise.all([
      supabase
        .from("medications")
        .select("id, drug_name, dose, source, created_at, schedule_effective_from, schedule_times, schedule_spec")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .is("superseded_at", null),
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, scheduled_time, status")
        .eq("patient_id", patientId)
        .eq("scheduled_for_date", today),
    ]);
    const failure = medsRes.error ?? logsRes.error;
    if (failure) return await localDoses(patientId, today, await pendingLogs(), failure.message);
    pullChangesThrottled(patientId);
    return {
      ok: true,
      data: buildTodaysDoseChecklist(medsRes.data ?? [], [...(await pendingLogs()), ...(logsRes.data ?? [])]),
    };
  } catch (e) {
    return await localDoses(patientId, today, await pendingLogs().catch(() => []), e instanceof Error ? e.message : String(e));
  }
}

/**
 * Offline read (S06): the medication list is the last copy pulled from the
 * server, read-only (INV-02: nothing here changes a treatment plan), with this
 * phone's unsent dose logs on top. With no copy yet, say so rather than show an
 * empty list as if it were a fact.
 */
async function localDoses(
  patientId: string,
  today: string,
  pending: LogForChecklist[],
  serverError: string
): Promise<QueryResult<DoseChecklistItem[]>> {
  const meds = await readLocalMedications<MedicationForChecklist>(patientId);
  if (meds.length === 0) return { ok: false, error: serverError };
  const mirrored = (await readLocalRecords<{ medication_id: string; scheduled_time: string | null; status: string; scheduled_for_date: string }>(
    "dose",
    patientId,
    200
  ))
    .filter((r) => r.scheduled_for_date === today)
    .map((r) => ({ medication_id: r.medication_id, scheduled_time: r.scheduled_time, status: r.status as never }));
  return { ok: true, data: buildTodaysDoseChecklist(meds, [...pending, ...mirrored]) };
}

export interface LogDoseOptions {
  /** ISO time the patient says they took it. Defaults to now. The server keeps it only inside its bounded window (S06). */
  recordedAt?: string;
  /** A short key for why a dose was skipped or could not be taken. */
  reason?: string | null;
  /** Keep the row on the phone for the undo window before it is sent. */
  hold?: boolean;
}

export type LoggableStatus = Exclude<DoseStatus, "pending"> | "delayed" | "not_available";

/**
 * Append-only (20260830224528): every dose action is a new row, never an
 * update of a previous one: mirrors useLogDose in
 * apps/web/src/lib/queries/medications.ts (a bare client insert is
 * safe here: the adherence side effect is a DB trigger on medication_logs,
 * not app code, so it fires the same way whichever client wrote the row).
 *
 * With `hold`, the row is durable on the phone at once but not sent until the
 * undo window has passed, so "undo" can really take it back (undoDose).
 */
export async function logDose(
  patientId: string,
  organisationId: string,
  item: DoseChecklistItem,
  status: LoggableStatus,
  opts: LogDoseOptions = {}
): Promise<{ error?: string; synced?: boolean; clientId?: string; heldUntilMs?: number }> {
  // S06: on-device outbox first (works with no signal), then sent at once. The
  // client id makes a blind retry a no-op, so a dose is never logged twice.
  const holdSeconds = opts.hold ? loadMedicineRules().undoSeconds : 0;
  let queued;
  try {
    queued = await enqueue({
      kind: "dose",
      subjectId: patientId,
      payload: {
        medication_id: item.medicationId,
        scheduled_time: item.time,
        scheduled_for_date: item.date ?? todayIsoDate(),
        status,
        organisation_id: organisationId,
        reason: opts.reason ?? null,
      },
      recordedAt: opts.recordedAt,
      holdSeconds,
    });
  } catch {
    return { error: "Couldn't save this on your phone. Try again." };
  }
  if (opts.hold) return { synced: false, clientId: queued.clientId, heldUntilMs: Date.now() + holdSeconds * 1000 };
  await flushOutbox();
  const stillThere = (await listOutbox("dose")).find((row) => row.clientId === queued.clientId);
  return { synced: !stillThere, clientId: queued.clientId };
}

/** Take back a dose that has not left the phone. False means it is too late (already sent) or gone. */
export function undoDose(clientId: string): Promise<boolean> {
  return removePendingRow(clientId);
}

/** Send what the undo window was holding. Safe to call at any time. */
export async function sendHeldDoses(): Promise<void> {
  await flushOutbox();
}

/** What to record for "I took it" at a chosen time: on time, or taken late. */
export function statusForTakenAt(dueAtMs: number, takenAtMs: number): "taken" | "delayed" {
  return takenStatus(dueAtMs, takenAtMs, loadReminderBehaviour().missedAfterMinutes);
}

// ---------------------------------------------------------------------------
// Weekly adherence and pill count (S08). The formula and the supply walk live in
// @tarragon/medicines; here only the reads.
// ---------------------------------------------------------------------------

interface AdherenceMedRow {
  id: string;
  created_at: string | null;
  schedule_effective_from?: string | null;
  schedule_times: unknown;
  schedule_spec: unknown;
}

interface AdherenceLogRow {
  medication_id: string;
  scheduled_for_date: string | null;
  scheduled_time: string | null;
  status: string | null;
  logged_at: string | null;
}

/** The patient's own week, computed on the phone so it works offline: doses marked taken over doses due. */
export async function loadWeeklyAdherence(patientId: string, nowMs: number = Date.now()): Promise<QueryResult<AdherenceResult>> {
  const band = loadAdherenceBand();
  const rules = loadMedicineRules();
  const missedAfterMinutes = loadReminderBehaviour().missedAfterMinutes;
  const start = addDays(lagosLocalDate(nowMs), -(band.windowDays - 1));

  let meds: AdherenceMedRow[];
  let logs: AdherenceLogRow[];
  try {
    const [medsRes, logsRes] = await Promise.all([
      supabase
        .from("medications")
        .select("id, created_at, schedule_effective_from, schedule_times, schedule_spec")
        .eq("patient_id", patientId)
        .eq("is_active", true)
        .is("superseded_at", null),
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, scheduled_for_date, scheduled_time, status, logged_at")
        .eq("patient_id", patientId)
        .gte("scheduled_for_date", start),
    ]);
    const failure = medsRes.error ?? logsRes.error;
    if (failure) return { ok: false, error: failure.message };
    meds = (medsRes.data ?? []) as AdherenceMedRow[];
    logs = (logsRes.data ?? []) as AdherenceLogRow[];
  } catch (e) {
    const localMeds = await readLocalMedications<AdherenceMedRow>(patientId);
    if (localMeds.length === 0) return { ok: false, error: e instanceof Error ? e.message : String(e) };
    meds = localMeds;
    logs = await readLocalRecords<AdherenceLogRow>("dose", patientId, 500);
  }

  // Doses logged on this phone and not yet sent count too, so the number never lags the screen.
  const pending = (await listOutbox("dose"))
    .filter((r) => r.subjectId === patientId)
    .map((r) => r.payload as DosePayload)
    .filter((p) => p.scheduled_for_date >= start)
    .map<AdherenceLogRow>((p) => ({
      medication_id: p.medication_id,
      scheduled_for_date: p.scheduled_for_date,
      scheduled_time: p.scheduled_time,
      status: p.status,
      logged_at: new Date(nowMs).toISOString(),
    }));

  const byMed = new Map<string, (DoseLog & { date: string; time: string })[]>();
  for (const row of [...logs, ...pending]) {
    if (!row.status || !row.scheduled_for_date || !row.scheduled_time) continue;
    const list = byMed.get(row.medication_id) ?? [];
    list.push({
      date: row.scheduled_for_date,
      time: row.scheduled_time,
      status: row.status as LogStatus,
      source: "patient",
      loggedAtMs: row.logged_at ? Date.parse(row.logged_at) : nowMs,
    });
    byMed.set(row.medication_id, list);
  }

  const result = computeWeeklyAdherence(
    meds.map((m) => ({
      id: m.id,
      spec: scheduleOf(m),
      logs: groupLogsBySlot(byMed.get(m.id) ?? []),
      activeFromMs: activeFromMs(m),
    })),
    nowMs,
    {
      windowDays: band.windowDays,
      minDoses: rules.adherenceMinDoses,
      missedAfterMinutes,
      thresholdPercent: band.percent,
    }
  );
  return { ok: true, data: result };
}

export interface SupplyRow {
  medicationId: string;
  pillsOnHand: number;
  pillsPerDose: number;
  countedAt: string;
}

export interface SupplyView extends SupplyRow {
  estimate: SupplyEstimate;
  low: boolean;
}

/** The pill counts the patient has set, each with how long it lasts at the current schedule. Two reads for the logs however many counts there are. */
export async function loadSupplies(
  patientId: string,
  medications: { id: string; schedule_times: unknown; schedule_spec?: unknown }[],
  nowMs: number = Date.now()
): Promise<QueryResult<Map<string, SupplyView>>> {
  const rules = loadMedicineRules();
  const today = lagosLocalDate(nowMs);
  try {
    const { data, error } = await supabase
      .from("medication_supply")
      .select("medication_id, pills_on_hand, pills_per_dose, counted_at")
      .eq("patient_id", patientId);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []).filter((r) => medications.some((m) => m.id === r.medication_id));
    const out = new Map<string, SupplyView>();
    if (rows.length === 0) return { ok: true, data: out };

    const ids = rows.map((r) => r.medication_id);
    const earliest = rows.reduce((min, r) => (r.counted_at < min ? r.counted_at : min), rows[0].counted_at);
    const [takenRes, answeredRes] = await Promise.all([
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, logged_at")
        .in("medication_id", ids)
        .gte("logged_at", earliest)
        .in("status", ["taken", "delayed"]),
      supabase
        .from("medication_logs_latest_per_slot")
        .select("medication_id, scheduled_for_date, scheduled_time")
        .in("medication_id", ids)
        .gte("scheduled_for_date", today)
        .in("status", ["taken", "delayed", "skipped", "not_available"]),
    ]);
    const failure = takenRes.error ?? answeredRes.error;
    if (failure) return { ok: false, error: failure.message };

    for (const row of rows) {
      const med = medications.find((m) => m.id === row.medication_id)!;
      const taken = (takenRes.data ?? []).filter((l) => l.medication_id === row.medication_id && l.logged_at !== null && l.logged_at >= row.counted_at).length;
      const answered = new Set(
        (answeredRes.data ?? []).filter((r) => r.medication_id === row.medication_id).map((r) => `${r.scheduled_for_date}|${r.scheduled_time}`)
      );
      const estimate = estimateSupply({
        pillsOnHand: Number(row.pills_on_hand),
        countedAtMs: Date.parse(row.counted_at),
        pillsPerDose: Number(row.pills_per_dose),
        spec: scheduleOf(med),
        dosesTakenSinceCount: taken,
        nowMs,
        answeredSlots: answered,
      });
      out.set(row.medication_id, {
        medicationId: row.medication_id,
        pillsOnHand: Number(row.pills_on_hand),
        pillsPerDose: Number(row.pills_per_dose),
        countedAt: row.counted_at,
        estimate,
        low: isRunningLow(estimate, rules.lowSupplyDays),
      });
    }
    return { ok: true, data: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Set or correct the pill count. The server stamps the count time, so a count cannot be backdated. */
export async function saveSupply(
  patientId: string,
  organisationId: string,
  medicationId: string,
  pillsOnHand: number,
  pillsPerDose: number
): Promise<{ error?: string }> {
  const { error } = await supabase.from("medication_supply").upsert(
    {
      medication_id: medicationId,
      patient_id: patientId,
      organisation_id: organisationId,
      pills_on_hand: pillsOnHand,
      pills_per_dose: pillsPerDose,
    },
    { onConflict: "medication_id" }
  );
  return error ? { error: error.message } : {};
}

// ---------------------------------------------------------------------------
// Medicines cabinet — backs medicine-cabinet-screen.tsx, the native replacement
// for the old WebViewScreen("/patient/medications") modal. Mirrors the read/
// write shapes of apps/web/src/lib/queries/medications.ts and its sibling
// query files (adherence-checkins, lab-monitoring, medication-repeat-requests)
// — duplicated rather than imported since apps/web isn't a shared package the
// mobile app can pull from (same reasoning as buildTodaysDoseChecklist above).
// ---------------------------------------------------------------------------

type MedicationSource = Tables<"medications">["source"];

export type MedicationCabinetItem = Pick<
  Tables<"medications">,
  | "id"
  | "drug_name"
  | "dose"
  | "frequency"
  | "schedule_times"
  | "source"
  | "prescriber_name"
  | "prescriber_document_url"
  | "refill_date"
  | "last_confirmed_at"
  | "expires_at"
  | "repeats_allowed"
  | "organisation_id"
  | "created_at"
  | "rx_number"
  | "verification_code"
  | "superseded_at"
> & { care_plan_condition: string | null };

const MEDICATION_CABINET_SELECT =
  "id, drug_name, dose, frequency, schedule_times, source, prescriber_name, prescriber_document_url, refill_date, last_confirmed_at, expires_at, repeats_allowed, organisation_id, created_at, rx_number, verification_code, superseded_at, care_plan:care_plans(condition)";

type MedicationCabinetRow = Omit<MedicationCabinetItem, "care_plan_condition"> & {
  care_plan: { condition: string } | { condition: string }[] | null;
};

function normaliseCabinetRow(row: MedicationCabinetRow): MedicationCabinetItem {
  const { care_plan, ...rest } = row;
  const condition = Array.isArray(care_plan) ? (care_plan[0]?.condition ?? null) : (care_plan?.condition ?? null);
  return { ...rest, care_plan_condition: condition };
}

/** Active medications, newest first — mirrors useMedications' ordering. */
export async function loadMedicationCabinet(patientId: string): Promise<QueryResult<MedicationCabinetItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medications")
      .select(MEDICATION_CABINET_SELECT)
      .eq("patient_id", patientId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: (data ?? []).map((row) => normaliseCabinetRow(row as unknown as MedicationCabinetRow)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface AddMedicationInput {
  drugName: string;
  dose?: string;
  frequency?: string;
  refillDate?: string;
  scheduleTimes: string[];
  /** The structured schedule (every few days, certain weekdays, step-down, as needed). When set, scheduleTimes is derived from it. */
  scheduleSpec?: ScheduleSpec;
  startedBySpecialist: boolean;
  prescriberName?: string;
  prescriberDocumentUrl?: string;
}

/**
 * Patient self-add, mirrors useAddMedication's patient-source branch exactly
 * (organisation_id resolved server-round-trip from the patient's own profile,
 * never trusted from the client). The clinician-prescribe path (draft/review/
 * sign, safety notes, controlled-substance ack) is web-only — a patient's own
 * cabinet never reaches that flow on either platform.
 */
export async function addMedication(patientId: string, input: AddMedicationInput): Promise<{ error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", patientId)
    .single();
  if (profileError) return { error: profileError.message };
  if (!profile?.organisation_id) return { error: "This patient has no organisation on file" };

  const source: MedicationSource = input.startedBySpecialist ? "specialist" : "patient";
  const { error } = await supabase.from("medications").insert({
    drug_name: input.drugName,
    dose: input.dose || null,
    frequency: input.frequency || null,
    refill_date: input.refillDate || null,
    schedule_times: input.scheduleSpec ? allTimes(input.scheduleSpec) : input.scheduleTimes,
    schedule_spec: input.scheduleSpec ? (input.scheduleSpec as unknown as Json) : null,
    patient_id: patientId,
    organisation_id: profile.organisation_id,
    source,
    prescriber_name: source === "specialist" ? input.prescriberName || null : null,
    prescriber_document_url: source === "specialist" ? input.prescriberDocumentUrl || null : null,
  });
  return error ? { error: error.message } : {};
}

// --- Adherence check-ins ----------------------------------------------------

export type AdherenceCheckinItem = Pick<
  Tables<"medication_adherence_checkins">,
  "id" | "checkin_type" | "due_date" | "status" | "response" | "medication_id"
> & { drug_name: string | null };

type AdherenceCheckinRow = Omit<AdherenceCheckinItem, "drug_name"> & {
  medication: { drug_name: string } | { drug_name: string }[] | null;
};

/** Mirrors checkinQuestion in apps/web/src/lib/queries/adherence-checkins.ts. */
export function checkinQuestion(type: string, drugName: string | null): string {
  const drug = drugName ?? "your medication";
  switch (type) {
    case "started":
      return `Have you started taking ${drug}?`;
    case "side_effects":
      return `Any side effects from ${drug}?`;
    case "missed_doses":
      return `How many doses of ${drug} have you missed recently?`;
    case "lab_review":
      return `It's time for a follow-up review of ${drug}. Anything you'd like your care team to know?`;
    default:
      return `A quick check-in about ${drug}.`;
  }
}

/** Pending check-ins due on/before today, soonest first. */
export async function loadDueCheckins(patientId: string): Promise<QueryResult<AdherenceCheckinItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medication_adherence_checkins")
      .select(
        "id, checkin_type, due_date, status, response, medication_id, medication:medications!medication_adherence_checkins_medication_id_fkey(drug_name)"
      )
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .lte("due_date", todayIsoDate())
      .order("due_date", { ascending: true });
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as AdherenceCheckinRow[];
    return {
      ok: true,
      data: rows.map(({ medication, ...rest }) => ({
        ...rest,
        drug_name: Array.isArray(medication) ? (medication[0]?.drug_name ?? null) : (medication?.drug_name ?? null),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function respondToCheckin(checkinId: string, response: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("medication_adherence_checkins")
    .update({ status: "responded", response, responded_at: new Date().toISOString() })
    .eq("id", checkinId);
  return error ? { error: error.message } : {};
}

// --- Lab monitoring due ------------------------------------------------------

export type LabMonitoringItem = Pick<
  Tables<"medication_lab_monitoring">,
  "id" | "monitoring_label" | "due_date" | "drug_class" | "medication_id"
> & { drug_name: string | null };

type LabMonitoringRow = Omit<LabMonitoringItem, "drug_name"> & {
  medication: { drug_name: string } | { drug_name: string }[] | null;
};

/** Pending drug-triggered lab monitoring — mirrors usePatientLabMonitoring. */
export async function loadLabMonitoring(patientId: string): Promise<QueryResult<LabMonitoringItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medication_lab_monitoring")
      .select(
        "id, monitoring_label, due_date, drug_class, medication_id, medication:medications!medication_lab_monitoring_medication_id_fkey(drug_name)"
      )
      .eq("patient_id", patientId)
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as LabMonitoringRow[];
    return {
      ok: true,
      data: rows.map(({ medication, ...rest }) => ({
        ...rest,
        drug_name: Array.isArray(medication) ? (medication[0]?.drug_name ?? null) : (medication?.drug_name ?? null),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// --- Refill: "next supply" requests + pharmacy collection status -----------
//
// Tarragon dropped pharmacy routing entirely 2026-08-03 (self-arranged
// fulfilment) — there is no "sent to pharmacy" step and no live order to
// track. "Pharmacy order status" here means exactly what the web cabinet
// shows: the patient's own collection record (pharmacy_order_dispenses,
// "I picked this up") plus the clinical review status of a repeat request
// (medication_repeat_requests) — never a fabricated delivery/logistics state.

export type RepeatRequestItem = Pick<
  Tables<"medication_repeat_requests">,
  "id" | "medication_id" | "status" | "requested_at" | "reviewed_at" | "denial_reason"
>;

export async function loadRepeatRequests(patientId: string): Promise<QueryResult<RepeatRequestItem[]>> {
  try {
    const { data, error } = await supabase
      .from("medication_repeat_requests")
      .select("id, medication_id, status, requested_at, reviewed_at, denial_reason")
      .eq("patient_id", patientId)
      .order("requested_at", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "I need my next supply" — every request needs clinical review, no
 * auto-approve path (20260829011000_medication_repeat_requests.sql). */
export async function requestMedicationRepeat(patientId: string, medicationId: string): Promise<{ error?: string }> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", patientId)
    .single();
  if (profileError) return { error: profileError.message };
  if (!profile?.organisation_id) return { error: "This patient has no organisation on file" };

  const { error } = await supabase.from("medication_repeat_requests").insert({
    medication_id: medicationId,
    patient_id: patientId,
    organisation_id: profile.organisation_id,
  });
  return error ? { error: error.message } : {};
}

export type MedicationCollectionItem = Pick<
  Tables<"pharmacy_order_dispenses">,
  "id" | "medication_id" | "dispensed_on" | "pharmacy_name"
>;

/** All of the patient's own collection records that reference a medication —
 * mirrors useMedicationCollections; callers pick the latest per medication. */
export async function loadMedicationCollections(patientId: string): Promise<QueryResult<MedicationCollectionItem[]>> {
  try {
    const { data, error } = await supabase
      .from("pharmacy_order_dispenses")
      .select("id, medication_id, dispensed_on, pharmacy_name")
      .eq("patient_id", patientId)
      .not("medication_id", "is", null)
      .order("dispensed_on", { ascending: false });
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: data ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "I picked this up" — mirrors MedicationCollectionForm exactly: writes
 * straight through the patient's own session, pharmacy_order_id stays null. */
export async function logMedicationCollection(
  patientId: string,
  organisationId: string,
  medicationId: string,
  drugName: string,
  collectedOn: string,
  pharmacyName: string
): Promise<{ error?: string }> {
  const { error } = await supabase.from("pharmacy_order_dispenses").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    medication_id: medicationId,
    drug_name: drugName,
    dispensed_on: collectedOn,
    pharmacy_name: pharmacyName.trim() || null,
    source: "patient",
  });
  return error ? { error: error.message } : {};
}

// --- Check my pack -----------------------------------------------------------
//
// Pure comparison logic ported verbatim from apps/web/src/lib/medications/
// pack-check.ts (same "duplicated, not imported" reasoning as elsewhere in
// this file). The web version's OCR read of the pack photo runs through a
// governed AI system (AI-007, ai-governance) invoked from a Next.js Server
// Action that calls Anthropic directly — there is no public API route for
// it, so it cannot be reached from the mobile app without registering a new
// AI call site, which is out of scope here. The native flow instead has the
// patient type what the pack actually says (still photographing it for their
// own reference) and runs the identical, deterministic comparison against
// their active medications — same verdicts, same NAFDAC-authenticity framing,
// just a typed reading in place of an OCR'd one.

export interface ParsedStrength {
  value: number;
  unit: string;
}

export function parseStrength(text: string | null | undefined): ParsedStrength | null {
  if (!text) return null;
  const match = text
    .toLowerCase()
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|ml|iu|%)/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  let unit = match[2];
  if (unit === "µg" || unit === "ug") unit = "mcg";
  return { value, unit };
}

function toBase(strength: ParsedStrength): { value: number; family: string } | null {
  switch (strength.unit) {
    case "mcg":
      return { value: strength.value / 1000, family: "mass" };
    case "mg":
      return { value: strength.value, family: "mass" };
    case "g":
      return { value: strength.value * 1000, family: "mass" };
    case "ml":
      return { value: strength.value, family: "volume" };
    case "iu":
      return { value: strength.value, family: "iu" };
    case "%":
      return { value: strength.value, family: "percent" };
    default:
      return null;
  }
}

export function strengthsMatch(a: ParsedStrength | null, b: ParsedStrength | null): boolean {
  if (!a || !b) return false;
  const ba = toBase(a);
  const bb = toBase(b);
  if (!ba || !bb || ba.family !== bb.family) return false;
  return Math.abs(ba.value - bb.value) < 1e-6;
}

export function drugNamesMatch(packName: string, prescribedName: string): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(tablets?|caps?|capsules?|syrup|suspension|injection|mr|sr|xl|er|od|bd|tds)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(packName);
  const b = norm(prescribedName);
  if (!a || !b) return false;
  if (a === b) return true;
  const aTokens = a.split(" ").filter((t) => t.length > 3);
  const bTokens = b.split(" ").filter((t) => t.length > 3);
  return aTokens.some((t) => bTokens.includes(t) || b.includes(t)) || bTokens.some((t) => a.includes(t));
}

export type PackCheckVerdict =
  | "matches_prescription"
  | "strength_differs"
  | "strength_unknown"
  | "not_on_your_list"
  | "unreadable";

export interface PackCheckResult {
  verdict: PackCheckVerdict;
  matchedDrugName: string | null;
  packStrength: ParsedStrength | null;
  prescribedStrength: ParsedStrength | null;
}

export interface PrescribedMedication {
  drugName: string;
  dose: string | null;
}

export function checkPackAgainstPrescription(
  pack: { drugName: string; strength: string | null },
  prescribed: PrescribedMedication[]
): PackCheckResult {
  const packStrength = parseStrength(pack.strength);
  const match = prescribed.find((m) => drugNamesMatch(pack.drugName, m.drugName));

  if (!match) {
    return { verdict: "not_on_your_list", matchedDrugName: null, packStrength, prescribedStrength: null };
  }

  const prescribedStrength = parseStrength(match.dose);
  if (!packStrength || !prescribedStrength) {
    return {
      verdict: "strength_unknown",
      matchedDrugName: match.drugName,
      packStrength,
      prescribedStrength,
    };
  }

  return {
    verdict: strengthsMatch(packStrength, prescribedStrength) ? "matches_prescription" : "strength_differs",
    matchedDrugName: match.drugName,
    packStrength,
    prescribedStrength,
  };
}

/** NAFDAC's Mobile Authentication Service — the only authenticity check this
 * feature ever points at, verbatim from apps/web's pack-check.ts. */
export const NAFDAC_MAS = {
  shortcode: "38353",
  howTo:
    "If the pack has a scratch panel, scratch it, then text the code it hides to 38353. NAFDAC will reply for free saying whether that code is genuine.",
  caveat:
    "Not every genuine medicine carries a scratch panel, so no panel does not mean a fake. If anything about a pack worries you, take it back to the pharmacy you bought it from and tell your care team.",
} as const;

/**
 * The prescription PDF for one clinician-prescribed medicine (or, with no id, every current one, one page each),
 * opened in expo-web-browser exactly like the verified-document PDFs: a plain https URL carrying the caller's
 * own short-lived access token, so Safari's viewer provides Print, Share and Save to Files. The server enforces
 * the issuing rules and the RLS scope; a refusal comes back as plain text in the viewer.
 */
export async function getPrescriptionPdfUrl(medicationId?: string): Promise<QueryResult<string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "Not signed in" };
  const token = encodeURIComponent(session.access_token);
  const path = medicationId ? `${medicationId}/pdf` : "pdf";
  return { ok: true, data: `${API_BASE_URL}/api/mobile/prescriptions/${path}?token=${token}` };
}
