import { supabase } from "./supabase";
import { readThrough } from "./passport-cache";
import { listOutbox, type SymptomPayload } from "./outbox";
import { readLocalRecords } from "./offline-store";
import { symptomLabel, type SymptomLog, type SymptomType } from "./symptoms";

/**
 * The symptom journal (S43, spec 2.4) on the phone: what the person noted, newest first, with the symptom check it came from and the grade
 * that check gave. The read is `public.patient_symptom_journal()`, the same function the web page uses, which is keyed on who is signed in,
 * so it is not offered while acting for someone else.
 *
 * Offline order of fallbacks: the last good copy of the journal, then the S06 read mirror of symptoms (no grade, because the mirror does not
 * hold triage), plus entries still waiting in the outbox, shown as waiting. Nothing is dropped and nothing waiting is shown as sent.
 */
export interface JournalRow {
  id: string;
  reportedAt: string;
  symptomType: string;
  freeText: string | null;
  severity: number | null;
  /** True when the entry came from a symptom check on the app (linked by the database). */
  fromCheck: boolean;
  triageGrade: "red" | "amber" | "green" | null;
  /** Saved on this phone and not yet sent. Never has a grade. */
  waiting: boolean;
}

interface RpcRow {
  symptom_id: string;
  reported_at: string;
  symptom_type: string;
  free_text: string | null;
  severity: number | null;
  assessment_id: string | null;
  triage_grade: string | null;
}

export function parseJournal(data: unknown): JournalRow[] {
  if (!Array.isArray(data)) return [];
  const rows: JournalRow[] = [];
  for (const raw of data as RpcRow[]) {
    if (!raw || typeof raw.symptom_id !== "string" || typeof raw.reported_at !== "string" || typeof raw.symptom_type !== "string") continue;
    const grade = raw.triage_grade === "red" || raw.triage_grade === "amber" || raw.triage_grade === "green" ? raw.triage_grade : null;
    rows.push({
      id: raw.symptom_id,
      reportedAt: raw.reported_at,
      symptomType: raw.symptom_type,
      freeText: raw.free_text,
      severity: typeof raw.severity === "number" ? raw.severity : null,
      fromCheck: raw.assessment_id !== null && raw.assessment_id !== undefined,
      triageGrade: grade,
      waiting: false,
    });
  }
  return rows;
}

export const journalLabel = (type: string): string => symptomLabel(type as SymptomType);

export type JournalLoad =
  | { ok: true; rows: JournalRow[]; stale: boolean; offline: boolean; savedAt: string | null }
  | { ok: false; offline: boolean };

function newestFirst(a: JournalRow, b: JournalRow): number {
  return b.reportedAt.localeCompare(a.reportedAt);
}

/** Entries saved on this phone and not yet sent for this person, so a symptom noted with no signal is visible at once. */
async function waitingRows(subjectId: string): Promise<JournalRow[]> {
  try {
    const items = await listOutbox("symptom");
    return items
      .filter((i) => i.state === "pending" && i.subjectId === subjectId)
      .map((i) => {
        const p = i.payload as SymptomPayload;
        return {
          id: `waiting:${i.clientId}`,
          reportedAt: i.clientRecordedAt,
          symptomType: p.symptom_type,
          freeText: p.description ?? null,
          severity: typeof p.severity === "number" ? p.severity : null,
          fromCheck: false,
          triageGrade: null,
          waiting: true,
        };
      });
  } catch {
    return [];
  }
}

export async function loadJournal(subjectId: string): Promise<JournalLoad> {
  const [live, waiting] = await Promise.all([
    readThrough<JournalRow[]>("journal", async () => {
      const { data, error } = await supabase.rpc("patient_symptom_journal", { p_limit: 100 });
      if (error) return { ok: false, error };
      return { ok: true, data: parseJournal(data) };
    }),
    waitingRows(subjectId),
  ]);

  if (live.ok) {
    const seen = new Set(live.data.map((r) => r.id));
    const rows = [...waiting.filter((w) => !seen.has(w.id)), ...live.data].sort(newestFirst);
    return live.stale
      ? { ok: true, rows, stale: true, offline: live.offline, savedAt: live.savedAt }
      : { ok: true, rows, stale: false, offline: false, savedAt: null };
  }

  // No live read and no saved copy: the S06 mirror still holds the symptoms this phone has seen.
  let mirror: SymptomLog[] = [];
  try {
    mirror = await readLocalRecords<SymptomLog>("symptom", subjectId, 100);
  } catch {
    mirror = [];
  }
  if (mirror.length === 0 && waiting.length === 0) return { ok: false, offline: live.offline };
  const fromMirror: JournalRow[] = mirror.map((s) => ({
    id: s.id,
    reportedAt: s.reported_at,
    symptomType: s.symptom_type,
    freeText: s.description,
    severity: s.severity,
    fromCheck: s.assessment_id !== null && s.assessment_id !== undefined,
    triageGrade: null,
    waiting: false,
  }));
  return { ok: true, rows: [...waiting, ...fromMirror].sort(newestFirst), stale: true, offline: live.offline, savedAt: null };
}
