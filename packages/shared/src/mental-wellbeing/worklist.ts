/**
 * The mental health follow-up worklist (S56b, function 2): reader for the database payload and the plain English description of each rule hit.
 * Clinician-facing, so the sentences live here rather than in the patient catalogue. Pure code, no model.
 *
 * What the list is NOT, and the screen says so: it is not a risk predictor, it sees only what a patient entered, and a patient who is not on it
 * is not "safe": silence is not safety.
 */
export type WorklistReasonCode = "unactioned_handoff" | "rising_screen" | "overdue_screen" | "missed_checkins" | "sleep_trouble";
export const WORKLIST_REASON_CODES: readonly WorklistReasonCode[] = ["unactioned_handoff", "rising_screen", "overdue_screen", "missed_checkins", "sleep_trouble"];

export interface WorklistReason { readonly code: WorklistReasonCode; readonly facts: Record<string, unknown> }
export interface WorklistRow {
  readonly patientId: string;
  readonly fullName: string | null;
  readonly patientNumber: string | null;
  readonly reasons: readonly WorklistReason[];
  /** When a follow-up was already made from the list (within the snooze window). The row stays visible. */
  readonly followedUpAt: string | null;
  readonly followedUpTask: string | null;
}
export type WorklistStatus = "ok" | "off" | "not_signed" | "unreadable";
export interface WorklistPayload {
  readonly status: WorklistStatus;
  readonly configVersion: number | null;
  readonly rows: readonly WorklistRow[];
  readonly notes: readonly string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseWorklist(raw: unknown): WorklistPayload {
  if (!isObj(raw) || typeof raw.status !== "string") return { status: "unreadable", configVersion: null, rows: [], notes: [] };
  if (raw.status === "off" || raw.status === "not_signed") return { status: raw.status, configVersion: null, rows: [], notes: [] };
  if (raw.status !== "ok" || !Array.isArray(raw.rows)) return { status: "unreadable", configVersion: null, rows: [], notes: [] };
  const rows: WorklistRow[] = [];
  for (const r of raw.rows) {
    if (!isObj(r) || typeof r.patient_id !== "string" || !Array.isArray(r.reasons)) continue;
    const reasons: WorklistReason[] = [];
    for (const x of r.reasons) {
      if (isObj(x) && typeof x.code === "string" && (WORKLIST_REASON_CODES as readonly string[]).includes(x.code)) {
        reasons.push({ code: x.code as WorklistReasonCode, facts: isObj(x.facts) ? x.facts : {} });
      }
    }
    rows.push({
      patientId: r.patient_id,
      fullName: typeof r.full_name === "string" ? r.full_name : null,
      patientNumber: typeof r.patient_number === "string" ? r.patient_number : null,
      reasons,
      followedUpAt: typeof r.followed_up_at === "string" ? r.followed_up_at : null,
      followedUpTask: typeof r.followed_up_task === "string" ? r.followed_up_task : null,
    });
  }
  return {
    status: "ok",
    configVersion: typeof raw.config_version === "number" ? raw.config_version : null,
    rows,
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === "string") : [],
  };
}

const INSTRUMENT: Record<string, string> = { phq9: "PHQ-9", gad7: "GAD-7" };
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
const when = (v: unknown): string => {
  const x = s(v);
  if (x === null) return "";
  const d = new Date(x.length === 10 ? `${x}T12:00:00+01:00` : x);
  return Number.isNaN(d.getTime()) ? x : DATE.format(d);
};

/** One plain sentence for a rule hit, with the numbers behind it. */
export function describeReason(r: WorklistReason): string {
  const f = r.facts;
  switch (r.code) {
    case "unactioned_handoff": {
      const kind = s(f.kind) === "doctor_summary" ? "A summary the patient chose to share" : s(f.kind) === "talk_request" ? "A request to talk" : "A questionnaire hand-off";
      return `${kind} has been waiting ${n(f.hours_waiting) ?? "?"} hours and nobody has marked it seen.`;
    }
    case "rising_screen":
      return `${INSTRUMENT[s(f.instrument) ?? ""] ?? "A questionnaire"} score went from ${n(f.from) ?? "?"} to ${n(f.to) ?? "?"} (up ${n(f.rise) ?? "?"}) between ${when(f.from_at)} and ${when(f.to_at)}.`;
    case "overdue_screen":
      return `The next ${INSTRUMENT[s(f.instrument) ?? ""] ?? "questionnaire"} was due ${when(f.due_date)}, ${n(f.days_overdue) ?? "?"} days ago.`;
    case "missed_checkins":
      return `No mood check-in for ${n(f.silent_days) ?? "?"} days, after ${n(f.prior_check_ins) ?? "?"} in the weeks before (last one ${when(f.last_check_in_on)}).`;
    case "sleep_trouble":
      return `The sleep diary shows ${n(f.trouble_nights) ?? "?"} short or poor nights out of ${n(f.entries) ?? "?"} logged in the last ${n(f.window_days) ?? "?"} days.`;
  }
}

/** What the worklist does not do. Shown on the page, always. */
export const WORKLIST_LIMITS: readonly string[] = [
  "It is not a risk predictor. It applies the fixed rules the Chief Medical Officer signed to what a patient has entered, and nothing else.",
  "A patient who is not on this list is not safe because of that. Silence is not safety.",
  "It cannot see a patient who has not screened, checked in, logged sleep or sent a hand-off, and it cannot see how someone feels between entries.",
  "It never replaces the urgent path. A crisis answer already pages the on-call clinician; this list is for follow-up.",
];
