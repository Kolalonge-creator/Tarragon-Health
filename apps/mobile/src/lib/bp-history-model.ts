import { lagosLocalDate, weekdayOf, LAGOS_OFFSET_MS, type LocalDate } from "./lagos-date";

/**
 * The History screen's pure rules (S07): own blood pressure readings by Lagos
 * day, with whether each reached the care team and where any correction request
 * stands. No drawing, no copy, no clock of its own.
 *
 * - A reading is never edited. A patient can only ASK for a correction; a
 *   member of the care team reviews it (data_correction_requests), and any change
 *   they make is logged by record_corrections, shown here as "corrected".
 * - History grades nothing: no "at target", "good" or "high". It shows what was
 *   logged, when, and what happened to it.
 * - A reading still on the phone, or not accepted, has nothing on the server to
 *   correct, so no request can be raised for it.
 * - One open request per reading; a refused or finished one can be followed by a
 *   new request.
 * - The server table has no link from a request to a reading, so the request
 *   carries a reference in its description (see readingReference). It also lets
 *   the reviewer find the exact row.
 */
export type SyncState = "sent" | "on_phone" | "not_accepted";
export type ReadingSource = "manual" | "device" | "wearable" | "other";
export type RequestStatus = "pending" | "under_review" | "approved" | "applied" | "denied";

export interface HistoryReading {
  id: string;
  systolic: number;
  diastolic: number;
  takenAt: string;
  source: ReadingSource;
  syncState: SyncState;
  /** Shown for a reading that was not accepted, so support can find it. */
  supportCode?: string;
}

export interface CorrectionRequest {
  id: string;
  status: RequestStatus;
  requestedAt: string;
  recordDescription: string;
  decisionNote: string | null;
  resolutionNote: string | null;
}

export interface RecordCorrection {
  entityId: string;
  correctedAt: string;
  changedColumns: string[];
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

export type RequestPhase = "open" | "approved" | "applied" | "denied";

export interface HistoryRow {
  reading: HistoryReading;
  /** Latest request about this reading, newest first. */
  request: { phase: RequestPhase; requestedAt: string; decisionNote: string | null; resolutionNote: string | null } | null;
  /** The latest change the care team made to this reading, when it was corrected. */
  correction: { correctedAt: string; before: string | null; after: string | null } | null;
  canAsk: boolean;
}

export interface HistoryDay {
  localDate: LocalDate;
  weekday: number;
  /** DD/MM */
  dayMonth: string;
  rows: HistoryRow[];
}

const REF_RE = /\[ref:vitals_readings:([0-9a-f-]{36})\]/i;

/** The reference placed in a request's description so it can be matched back to its reading. */
export function readingReference(readingId: string): string {
  return `[ref:vitals_readings:${readingId}]`;
}

export function referencedReadingId(description: string): string | null {
  return REF_RE.exec(description)?.[1]?.toLowerCase() ?? null;
}

/** "14:05" in Lagos time. */
export function lagosClock(utcMs: number): string {
  const d = new Date(utcMs + LAGOS_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "04/10/2026" in Lagos time, or "" for an unreadable instant. */
export function lagosDateText(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = lagosLocalDate(ms);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/**
 * The description saved with the request. Plain words first, as a person on the
 * care team would read it, then the reference. Numbers and time only; nothing
 * about how the reading was classified.
 */
export function buildRecordDescription(reading: Pick<HistoryReading, "id" | "systolic" | "diastolic" | "takenAt">): string {
  const ms = Date.parse(reading.takenAt);
  const when = Number.isFinite(ms) ? `${lagosLocalDate(ms)} ${lagosClock(ms)} (Lagos)` : reading.takenAt;
  return `Blood pressure reading ${reading.systolic}/${reading.diastolic} mmHg, ${when} ${readingReference(reading.id)}`;
}

const phaseOf = (status: RequestStatus): RequestPhase =>
  status === "pending" || status === "under_review" ? "open" : status;

function bpText(values: Record<string, unknown> | null, columns: string[]): string | null {
  if (!values) return null;
  const s = values.systolic;
  const d = values.diastolic;
  if (!columns.includes("systolic") && !columns.includes("diastolic")) return null;
  return typeof s === "number" && typeof d === "number" ? `${s}/${d}` : null;
}

export interface BuildHistoryInput {
  readings: readonly HistoryReading[];
  requests: readonly CorrectionRequest[];
  corrections: readonly RecordCorrection[];
  /** False while acting for someone else, or when requests could not be loaded: nothing can be asked then. */
  canRequest: boolean;
}

export function buildHistory(input: BuildHistoryInput): HistoryDay[] {
  const latestRequest = new Map<string, CorrectionRequest>();
  for (const q of input.requests) {
    const id = referencedReadingId(q.recordDescription);
    if (!id) continue;
    const prev = latestRequest.get(id);
    if (!prev || q.requestedAt > prev.requestedAt) latestRequest.set(id, q);
  }
  const latestCorrection = new Map<string, RecordCorrection>();
  for (const c of input.corrections) {
    const id = c.entityId.toLowerCase();
    const prev = latestCorrection.get(id);
    if (!prev || c.correctedAt > prev.correctedAt) latestCorrection.set(id, c);
  }

  const rows: HistoryRow[] = input.readings.map((reading) => {
    const id = reading.id.toLowerCase();
    const q = latestRequest.get(id) ?? null;
    const c = latestCorrection.get(id) ?? null;
    const phase = q ? phaseOf(q.status) : null;
    return {
      reading,
      request: q && phase ? { phase, requestedAt: q.requestedAt, decisionNote: q.decisionNote, resolutionNote: q.resolutionNote } : null,
      correction: c
        ? { correctedAt: c.correctedAt, before: bpText(c.oldValues, c.changedColumns), after: bpText(c.newValues, c.changedColumns) }
        : null,
      canAsk: input.canRequest && reading.syncState === "sent" && phase !== "open" && phase !== "approved",
    };
  });

  const byDay = new Map<LocalDate, HistoryRow[]>();
  for (const row of rows) {
    const ms = Date.parse(row.reading.takenAt);
    if (!Number.isFinite(ms)) continue;
    const d = lagosLocalDate(ms);
    byDay.set(d, [...(byDay.get(d) ?? []), row]);
  }
  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([localDate, dayRows]) => ({
      localDate,
      weekday: weekdayOf(localDate),
      dayMonth: `${localDate.slice(8, 10)}/${localDate.slice(5, 7)}`,
      rows: dayRows.sort((a, b) => b.reading.takenAt.localeCompare(a.reading.takenAt) || b.reading.id.localeCompare(a.reading.id)),
    }));
}

export interface ServerBpRow {
  id: string;
  systolic: number | null;
  diastolic: number | null;
  taken_at: string;
  source: string | null;
  client_reading_id?: string | null;
}

export interface QueuedBp {
  clientId: string;
  state: "pending" | "rejected" | string;
  systolic: number;
  diastolic: number;
  clientRecordedAt: string;
  supportCode: string;
}

const sourceOf = (s: string | null): ReadingSource =>
  s === "manual" ? "manual" : s === "device" || s === "cgm" ? "device" : s === "wearable" ? "wearable" : "other";

/**
 * Server readings plus readings still on the phone. A row on the server wins over
 * its own queued copy (a flush in flight), so nothing shows twice. A queued row
 * that is neither waiting nor rejected is not shown.
 */
export function mergeReadings(server: readonly ServerBpRow[], queued: readonly QueuedBp[]): HistoryReading[] {
  const onServer = new Set(server.map((r) => r.client_reading_id).filter((id): id is string => !!id));
  const sent: HistoryReading[] = server
    .filter((r): r is ServerBpRow & { systolic: number; diastolic: number } => r.systolic !== null && r.diastolic !== null)
    .map((r) => ({ id: r.id, systolic: r.systolic, diastolic: r.diastolic, takenAt: r.taken_at, source: sourceOf(r.source), syncState: "sent" }));
  const waiting: HistoryReading[] = queued
    .filter((q) => (q.state === "pending" || q.state === "rejected") && !onServer.has(q.clientId))
    .map((q) => ({
      id: q.clientId,
      systolic: q.systolic,
      diastolic: q.diastolic,
      takenAt: q.clientRecordedAt,
      source: "manual",
      syncState: q.state === "rejected" ? "not_accepted" : "on_phone",
      ...(q.state === "rejected" ? { supportCode: q.supportCode } : {}),
    }));
  return [...waiting, ...sent];
}
