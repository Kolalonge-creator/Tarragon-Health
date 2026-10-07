import { supabase } from "./supabase";

/**
 * Joining a programme that an employer, insurer or organisation offers (S38e on the phone). Joining shares nothing. Sharing group figures
 * is a separate, optional choice that can be turned off at any time and ends when the person leaves. Every result is a status the screen
 * words; a failed call is never shown as success, and a refused code is never explained beyond "did not work" (the database gives the same
 * answer for an unknown, expired, closed and full code).
 */
export interface Membership { cohortId: string; name: string; sponsor: string; joinedAt: string; sharing: boolean; sharingOpen: boolean }
export type MembershipsLoad = { ok: true; memberships: Membership[] } | { ok: false };
export type JoinResult = "joined" | "already" | "code_invalid" | "error";
export type ActionResult = "saved" | "unavailable" | "error";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseMemberships(data: unknown): Membership[] | null {
  if (!Array.isArray(data)) return null;
  const out: Membership[] = [];
  for (const r of data) {
    if (!isRec(r) || typeof r.cohort_id !== "string" || typeof r.name !== "string" || typeof r.sponsor !== "string" || typeof r.joined_at !== "string"
      || typeof r.reporting_consent !== "boolean" || typeof r.consent_available !== "boolean") return null;
    out.push({ cohortId: r.cohort_id, name: r.name, sponsor: r.sponsor, joinedAt: r.joined_at, sharing: r.reporting_consent, sharingOpen: r.consent_available });
  }
  return out;
}

export async function loadMemberships(): Promise<MembershipsLoad> {
  try {
    const { data, error } = await supabase.rpc("my_cohorts");
    if (error) return { ok: false };
    const m = parseMemberships(data);
    return m ? { ok: true, memberships: m } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function joinProgramme(code: string): Promise<JoinResult> {
  const trimmed = code.trim();
  if (trimmed.length < 4 || trimmed.length > 20) return "code_invalid";
  try {
    const { data, error } = await supabase.rpc("join_cohort", { p_code: trimmed });
    if (error || !isRec(data)) return "error";
    if (data.ok !== true) return "code_invalid";
    return data.status === "already" ? "already" : "joined";
  } catch {
    return "error";
  }
}

export async function setSharing(cohortId: string, granted: boolean): Promise<ActionResult> {
  try {
    const { data, error } = await supabase.rpc("set_cohort_reporting_consent", { p_cohort: cohortId, p_granted: granted });
    if (error || !isRec(data)) return "error";
    if (data.ok === true) return "saved";
    return data.reason === "not_available" ? "unavailable" : "error";
  } catch {
    return "error";
  }
}

export async function leaveProgramme(cohortId: string): Promise<"saved" | "error"> {
  try {
    const { data, error } = await supabase.rpc("leave_cohort", { p_cohort: cohortId });
    return !error && isRec(data) && data.ok === true ? "saved" : "error";
  } catch {
    return "error";
  }
}

/** The current sharing consent text, word for word, or null when it cannot be read. It is what the person agrees to, so sharing is not
 * offered without it. */
export async function loadSharingText(): Promise<string | null> {
  try {
    const { data, error } = await supabase.from("consent_versions").select("body").eq("consent_type", "sponsor_reporting").eq("is_current", true).limit(1).maybeSingle();
    return !error && typeof data?.body === "string" && data.body.trim() !== "" ? data.body : null;
  } catch {
    return null;
  }
}
