import type { MessageKey } from "@tarragon/i18n";

/**
 * What the community section reads (S69). Parsed by hand and never trusted. There is no field here for an individual's figure: the
 * challenge view the database sends has a closed key set, and anything else a reply carries is dropped.
 */
export const COHORT_KINDS = ["church", "mosque", "union", "estate", "workplace"] as const;
export type CohortKind = (typeof COHORT_KINDS)[number];
export const KIND_KEYS: Readonly<Record<CohortKind, MessageKey>> = {
  church: "community.kind.church", mosque: "community.kind.mosque", union: "community.kind.union", estate: "community.kind.estate", workplace: "community.kind.workplace",
};
export type Unit = "days" | "lessons" | "minutes";
export const UNIT_KEYS: Readonly<Record<Unit, MessageKey>> = { days: "community.unit.days", lessons: "community.unit.lessons", minutes: "community.unit.minutes" };

export type Cohort = { cohortId: string; name: string; kind: CohortKind; state: "active" | "closed" | "frozen"; isModerator: boolean; muted: boolean; contributing: boolean };
export type MyCohorts = { open: boolean; off: boolean; cohorts: Cohort[] };
export type Total = { state: "pending" } | { state: "hidden" } | { state: "shown"; total: number; progressPct: number; goalReached: boolean; groupSize: string; asOf: string };
export type Challenge = { challengeId: string; label: string; unit: Unit; startsOn: string; endsOn: string; phase: "scheduled" | "active" | "ended" | "cancelled"; available: boolean; total: Total };
export type RosterRow = { memberId: string; firstName: string; role: "member" | "moderator"; isYou: boolean };
export type BoardRow = { label: string; rank: number; progressPct: number; isYours: boolean };
export type Board = { state: "hidden" } | { state: "not_ready" } | { state: "shown"; rows: BoardRow[] };
export type Template = { code: string; label: string; unit: Unit; defaultDays: number };

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const UNITS = ["days", "lessons", "minutes"] as const;

export function parseMyCohorts(data: unknown): MyCohorts {
  const o = obj(data);
  if (!o || typeof o.open !== "boolean" || !Array.isArray(o.cohorts)) return { open: false, off: false, cohorts: [] };
  const cohorts = o.cohorts.flatMap((row): Cohort[] => {
    const r = obj(row);
    if (!r) return [];
    const id = str(r.cohort_id), name = str(r.name), kind = oneOf(r.kind, COHORT_KINDS), state = oneOf(r.state, ["active", "closed", "frozen"] as const);
    const mod = bool(r.is_moderator), muted = bool(r.muted), contributing = bool(r.contributing);
    if (!id || !name || !kind || !state || mod === null || muted === null || contributing === null) return [];
    return [{ cohortId: id, name, kind, state, isModerator: mod, muted, contributing }];
  });
  return { open: o.open, off: o.off === true, cohorts };
}

function parseTotal(v: unknown): Total {
  const o = obj(v);
  const state = o ? o.state : null;
  if (o && state === "shown") {
    const total = num(o.total), pct = num(o.progress_pct), goal = bool(o.goal_reached), size = str(o.group_size), asOf = str(o.as_of);
    if (total !== null && pct !== null && goal !== null && size && asOf) return { state: "shown", total, progressPct: Math.max(0, Math.min(100, pct)), goalReached: goal, groupSize: size, asOf };
  }
  return state === "hidden" ? { state: "hidden" } : { state: "pending" };
}

export function parseChallenges(data: unknown): Challenge[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row): Challenge[] => {
    const r = obj(row);
    if (!r) return [];
    const id = str(r.challenge_id), label = str(r.label), unit = oneOf(r.unit, UNITS), s = str(r.starts_on), e = str(r.ends_on);
    const phase = oneOf(r.phase, ["scheduled", "active", "ended", "cancelled"] as const), available = bool(r.available);
    if (!id || !label || !unit || !s || !e || !phase || available === null) return [];
    return [{ challengeId: id, label, unit, startsOn: s, endsOn: e, phase, available, total: parseTotal(r.total) }];
  });
}

export function parseRoster(data: unknown): RosterRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row): RosterRow[] => {
    const r = obj(row);
    if (!r) return [];
    const id = str(r.member_id), name = str(r.first_name), role = oneOf(r.role, ["member", "moderator"] as const), you = bool(r.is_you);
    return id && name && role && you !== null ? [{ memberId: id, firstName: name, role, isYou: you }] : [];
  });
}

export function parseBoard(data: unknown): Board {
  const o = obj(data);
  if (o?.state === "not_ready") return { state: "not_ready" };
  if (o?.state === "shown" && Array.isArray(o.rows)) {
    const rows = o.rows.flatMap((row): BoardRow[] => {
      const r = obj(row);
      const label = r ? str(r.label) : null, rank = r ? num(r.rank) : null, pct = r ? num(r.progress_pct) : null, yours = r ? bool(r.is_yours) : null;
      return label && rank !== null && pct !== null && yours !== null ? [{ label, rank, progressPct: pct, isYours: yours }] : [];
    });
    return { state: "shown", rows };
  }
  return { state: "hidden" };
}

export function parseTemplates(data: unknown): Template[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row): Template[] => {
    const r = obj(row);
    const code = r ? str(r.code) : null, label = r ? str(r.label) : null, unit = r ? oneOf(r.unit, UNITS) : null, days = r ? num(r.default_days) : null;
    return code && label && unit && days !== null ? [{ code, label, unit, defaultDays: days }] : [];
  });
}

export function parsePreview(data: unknown): { ok: false } | { ok: true; name: string; kind: CohortKind } {
  const o = obj(data);
  const name = o ? str(o.name) : null, kind = o ? oneOf(o.kind, COHORT_KINDS) : null;
  return o?.ok === true && name && kind ? { ok: true, name, kind } : { ok: false };
}

export function parseOk(data: unknown): { ok: boolean; reason: string | null; capped: boolean; counted: boolean | null; cohortId: string | null } {
  const o = obj(data);
  return { ok: o?.ok === true, reason: o ? str(o.reason) : null, capped: o?.capped === true, counted: o && typeof o.counted === "boolean" ? o.counted : null, cohortId: o ? str(o.cohort_id) : null };
}

export function parseInviteMade(data: unknown): { token: string; expiresAt: string } | null {
  const o = obj(data);
  const token = o ? str(o.token) : null, exp = o ? str(o.expires_at) : null;
  return token && token.length >= 20 && exp ? { token, expiresAt: exp } : null;
}

/** The token from a pasted link or the bare token. */
export function tokenFromInput(raw: string): string {
  const s = raw.trim();
  const m = /\/community\/join\/([^/?#\s]+)/.exec(s);
  if (m?.[1]) {
    try { return decodeURIComponent(m[1]); } catch { return ""; }
  }
  return /^[A-Za-z0-9_-]{20,100}$/.test(s) ? s : "";
}

/** The link a moderator shares: the token is in the path only. No WhatsApp link is built; the phone's share menu is the only way out. */
export function communityJoinPath(token: string): string {
  return `/patient/community/join/${encodeURIComponent(token)}`;
}

const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  community_closed: "community.error.closed", community_off: "community.error.community_off", consent_required: "community.error.consent_required",
  cohort_name_not_allowed: "community.error.cohort_name_not_allowed", too_many_cohorts: "community.error.too_many_cohorts",
  too_many_challenges: "community.error.too_many_challenges", template_not_approved: "community.error.template_not_approved",
  challenge_dates_invalid: "community.error.challenge_dates_invalid", invite_rate_limited: "community.error.invite_rate_limited",
  cohort_full: "community.error.cohort_full", minutes_invalid: "community.error.minutes_invalid", community_not_authorised: "community.error.not_authorised",
};
export function communityErrorKey(message: unknown): MessageKey {
  if (typeof message !== "string") return "community.error.unknown";
  const hit = Object.keys(ERROR_KEYS).find((c) => message.includes(c));
  return (hit ? ERROR_KEYS[hit] : undefined) ?? "community.error.unknown";
}
