import { monthLabel } from "@tarragon/i18n";
import { supabase } from "./supabase";

/**
 * A sponsor's own staff read their programme's group figures (S38f, OQ-258). Only the frozen monthly figure the database wrote after the
 * month closed: there is no live report and no refresh, so there is nothing to run twice. The database withholds a small group whole; this
 * file only words what it is given and never computes or fills in a number.
 */
export const SPONSOR_STAFF_ROLES = ["hmo_admin", "corporate_admin", "ngo_admin"] as const;
export function isSponsorStaffRole(role: string | null | undefined): boolean {
  return !!role && (SPONSOR_STAFF_ROLES as readonly string[]).includes(role);
}
/** Which app a signed-in person gets. Anything that is not a sponsor staff role gets the patient app, as before. */
export function shellForRole(role: string | null | undefined): "sponsor" | "patient" {
  return isSponsorStaffRole(role) ? "sponsor" : "patient";
}

export interface Programme { id: string; name: string; code: string | null; validFrom: string; validTo: string; status: "active" | "closed"; latestPeriod: string | null }
export type ProgrammesLoad = { ok: true; sponsor: string; programmes: Programme[] } | { ok: false };
export interface FigureLine { label: string; value: string }
export interface MonthFigures { period: string; label: string; lines: FigureLine[]; note: string }
export type FiguresLoad = { ok: true; months: MonthFigures[] } | { ok: false };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A number the database must have sent. A missing one rejects the whole month: a figure is never filled in with 0 or a placeholder. */
function need(v: unknown): number {
  const n = num(v);
  if (n === null) throw new Error("figure missing");
  return n;
}
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const pct = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}%`;

export function parseProgrammes(data: unknown): { sponsor: string; programmes: Programme[] } | null {
  if (!isRec(data) || typeof data.sponsor !== "string" || !Array.isArray(data.programmes)) return null;
  const programmes: Programme[] = [];
  for (const p of data.programmes) {
    if (!isRec(p)) return null;
    const id = str(p.id), name = str(p.name), from = str(p.valid_from), to = str(p.valid_to);
    if (!id || !name || !from || !to || (p.status !== "active" && p.status !== "closed")) return null;
    programmes.push({ id, name, code: str(p.code), validFrom: from, validTo: to, status: p.status, latestPeriod: str(p.latest_period) });
  }
  return { sponsor: data.sponsor, programmes };
}

function withheld(f: Rec): string | null {
  if (f.suppressed !== true) return null;
  const min = num(f.minimum);
  return min === null ? "Not shown" : f.reason === "under_minimum" ? `Fewer than ${min} people, so nothing is shown` : `A group is smaller than ${min}, so the counts are withheld`;
}

/** The lines of one month, in the order the sponsor reads them. A figure the database withheld is worded as withheld, never as zero. */
export function figureLines(f: unknown): FigureLine[] | null {
  // A month the database held back (too few people changed since the last figure): say so, show nothing else for it.
  if (isRec(f) && f.held_back === true) return [{ label: "This month", value: "Held back: only a few people changed since the last figure, so it is not shown yet" }];
  try {
    return strictLines(f);
  } catch {
    return null;
  }
}

function strictLines(f: unknown): FigureLine[] {
  if (!isRec(f)) throw new Error("figures missing");
  const members = f.members, bp = f.bp_control_90d, chg = f.change_among_measured, adh = f.adherence_separate, eng = f.engagement_separate;
  if (!isRec(members) || !isRec(bp) || !isRec(chg) || !isRec(adh) || !isRec(eng)) throw new Error("section missing");
  const out: FigureLine[] = [];

  out.push({ label: "Members who agreed to share", value: withheld(members) ?? `${need(members.agreed_to_share)} of ${need(members.joined)} (${pct(need(members.agreed_pct))})` });

  const bw = withheld(bp);
  if (bw) out.push({ label: "Blood pressure under control at 90 days", value: bw });
  else {
    out.push({ label: "Blood pressure under control at 90 days", value: `${pct(need(bp.rate_strict_pct))} of ${need(bp.n)} people` });
    const among = num(bp.rate_among_measured_pct);   // legitimately absent when too few were measured
    out.push({ label: "Among those measured", value: among === null ? "Withheld, too few people" : pct(among) });
    out.push({ label: "No or too few readings", value: pct(need(bp.missing_pct)) });
  }
  out.push({ label: "Average change from day 0 (systolic / diastolic)", value: withheld(chg) ?? `${need(chg.mean_systolic_change)} / ${need(chg.mean_diastolic_change)} mmHg` });
  out.push({ label: "Medicines taken as planned (kept separate)", value: withheld(adh) ?? pct(need(adh.mean_pct)) });
  out.push({ label: "Logged a reading in the last 30 days (kept separate)", value: withheld(eng) ?? pct(need(eng.logged_a_reading_in_30_days_pct)) });
  return out;
}

export function parseFigures(data: unknown): MonthFigures[] | null {
  if (!isRec(data) || data.ok !== true || !Array.isArray(data.months)) return null;
  const months: MonthFigures[] = [];
  for (const row of data.months) {
    if (!isRec(row)) return null;
    const period = str(row.period);
    const lines = figureLines(row.figures);
    if (!period || !lines) return null;
    const note = isRec(row.figures) ? str(row.figures.limitations) : null;
    months.push({ period, label: monthLabel(period), lines, note: note ?? "" });
  }
  return months;
}

export async function loadProgrammes(): Promise<ProgrammesLoad> {
  try {
    const { data, error } = await supabase.rpc("sponsor_staff_programmes");
    if (error) return { ok: false };
    const p = parseProgrammes(data);
    return p ? { ok: true, ...p } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function loadFigures(cohortId: string): Promise<FiguresLoad> {
  try {
    const { data, error } = await supabase.rpc("sponsor_staff_figures", { p_cohort: cohortId });
    if (error) return { ok: false };
    const months = parseFigures(data);
    return months ? { ok: true, months } : { ok: false };
  } catch {
    return { ok: false };
  }
}
