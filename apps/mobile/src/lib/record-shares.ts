import { getProposedConfig } from "@tarragon/shared";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "./supabase";
import { PLATFORM_URL } from "./platform-url";
import { cacheRead, cacheWrite, isOffline, readThrough, type ReadResult } from "./passport-cache";

/**
 * Share my record (S09/S09x/S43 spec 2.8) on the phone: choose what, for how long, with an optional PIN, a one-session window, a label and a view
 * cap; see who can still open it; stop it. Same database functions as the web page (apps/web/src/lib/queries/record-shares.ts).
 *
 * Rules kept here:
 *  - There is no reproductive-health or mental-health section to choose. That is NOT the same as a link never carrying such details: the medicines
 *    and conditions sections list everything on those lists, so the screen says so beside them (OQ-S43m-7).
 *  - The link and the PIN are returned once by the database and are shown once. They are never put in the saved copy, never logged, and the
 *    saved list does not contain the link at all (the list is for seeing and stopping links, not for reading them back).
 *  - Everything here needs a connection and says so; nothing is queued, because a link that looks created but is not is a worse failure than none.
 */
export const SHARE_SECTIONS = ["vitals", "medications", "conditions", "allergies", "lab_results", "vaccinations", "emergency_info"] as const;
export type ShareSection = (typeof SHARE_SECTIONS)[number];

/** Mirrors apps/web/src/lib/my-health/share-options.ts (a mobile Jest test fails if the two lists differ). */
export const SHARE_MAX_VIEWS_CHOICES = [1, 3, 5, 10] as const;

export interface SharingConfig {
  readonly default_expiry_hours: number;
  readonly max_expiry_hours: number;
  readonly expiry_options_hours: readonly number[];
  readonly pin_digits: number;
  readonly one_session_window_minutes: number;
}

/** The app's mirror of the active `my_health_config` (the database enforces it). Same source as the web page. */
export function getSharingConfig(): SharingConfig {
  return (getProposedConfig("my_health.sharing_and_access_log").value as unknown as { sharing: SharingConfig }).sharing;
}

/** "6 hours", "1 day", "7 days". */
export function expiryLabel(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return t(days === 1 ? "share.expiry.days_one" : "share.expiry.days_other", "en", { count: String(days) });
  }
  return t(hours === 1 ? "share.expiry.hours_one" : "share.expiry.hours_other", "en", { count: String(hours) });
}

export function viewsLeft(maxViews: number | null, viewCount: number): number | null {
  return maxViews === null ? null : Math.max(maxViews - viewCount, 0);
}

export interface ShareSummary {
  id: string;
  sections: string[];
  expiresAt: string;
  viewCount: number;
  pinProtected: boolean;
  oneSession: boolean;
  locked: boolean;
  recipientLabel: string | null;
  maxViews: number | null;
}

interface ShareRow {
  id: string;
  sections: string[];
  expires_at: string;
  is_active: boolean;
  view_count: number;
  pin_protected: boolean | null;
  one_session: boolean;
  locked_at: string | null;
  recipient_label: string | null;
  max_views: number | null;
}

export const sharesCacheKey = (patientId: string) => `shares:${patientId}`;

/** Links that can still be opened: active, not past their expiry and not locked out. Sorted soonest-to-end first is not needed: newest first as stored. */
export function parseShares(rows: unknown, now: Date = new Date()): ShareSummary[] {
  if (!Array.isArray(rows)) return [];
  const out: ShareSummary[] = [];
  for (const r of rows as ShareRow[]) {
    if (!r || typeof r.id !== "string" || typeof r.expires_at !== "string" || !Array.isArray(r.sections)) continue;
    if (!r.is_active || new Date(r.expires_at).getTime() <= now.getTime()) continue;
    out.push({
      id: r.id,
      sections: r.sections.filter((s): s is string => typeof s === "string"),
      expiresAt: r.expires_at,
      viewCount: typeof r.view_count === "number" ? r.view_count : 0,
      pinProtected: r.pin_protected === true,
      oneSession: r.one_session === true,
      locked: r.locked_at !== null && r.locked_at !== undefined,
      recipientLabel: r.recipient_label,
      maxViews: typeof r.max_views === "number" ? r.max_views : null,
    });
  }
  return out;
}

/**
 * The person's own links. The link itself is NOT selected: it is fetched only when they ask to send it again (fetchShareLink), so it never
 * sits in the saved copy. A supporter does not manage someone else's links from the phone, so there is no `own: false` read.
 */
export async function loadShares(patientId: string): Promise<ReadResult<ShareSummary[]>> {
  const r = await readSharesThrough(patientId);
  // A saved copy may hold a link that has expired since it was saved: expiry is applied again when it is read, never trusted from the copy.
  if (r.ok && r.stale) {
    const now = Date.now();
    return { ...r, data: r.data.filter((s) => new Date(s.expiresAt).getTime() > now) };
  }
  return r;
}

/** After a link is stopped: take it out of the saved copy too, so a later failed refresh cannot show it as live again. */
export async function forgetShare(patientId: string, shareId: string): Promise<void> {
  const copy = await cacheRead<ShareSummary[]>(sharesCacheKey(patientId));
  if (copy) await cacheWrite(sharesCacheKey(patientId), copy.value.filter((s) => s.id !== shareId));
}

function readSharesThrough(patientId: string): Promise<ReadResult<ShareSummary[]>> {
  return readThrough(sharesCacheKey(patientId), async () => {
    const { data, error } = await supabase
      .from("record_shares")
      .select("id, sections, expires_at, is_active, view_count, pin_protected, one_session, locked_at, recipient_label, max_views")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { ok: false, error };
    return { ok: true, data: parseShares(data) };
  });
}

export function shareUrl(token: string): string {
  return `${PLATFORM_URL}/share/${token}`;
}

/** The text sent with a link. It names no condition, reading or result (INV-07 applies to anything that leaves the app as a message). */
export function shareMessage(token: string): string {
  return `${t("mpass.share.message")} ${shareUrl(token)}`;
}

export type ShareFailure = "offline" | "failed" | "no_section" | "bad_expiry" | "bad_views" | "label_too_long" | "options_unavailable";

export interface CreateShareInput {
  sections: readonly string[];
  expiresInHours: number;
  usePin: boolean;
  oneSession: boolean;
  recipientLabel: string;
  maxViews: number | null;
}

export interface CreatedShare {
  id: string;
  token: string;
  pin: string | null;
  expiresAt: string;
}

export type CreateShareResult = { ok: true; share: CreatedShare } | { ok: false; reason: ShareFailure };

export function validateCreateShare(input: CreateShareInput, config: SharingConfig = getSharingConfig()): ShareFailure | null {
  const sections = input.sections.filter((s) => (SHARE_SECTIONS as readonly string[]).includes(s));
  if (sections.length === 0 || sections.length !== input.sections.length) return "no_section";
  if (!config.expiry_options_hours.includes(input.expiresInHours)) return "bad_expiry";
  if (input.maxViews !== null && !(SHARE_MAX_VIEWS_CHOICES as readonly number[]).includes(input.maxViews)) return "bad_views";
  if (input.recipientLabel.trim().length > 80) return "label_too_long";
  return null;
}

/** An RPC that is not in the database yet (the label and view-cap options ship in a later migration than the base function). */
function missingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

export async function createShare(input: CreateShareInput): Promise<CreateShareResult> {
  const invalid = validateCreateShare(input);
  if (invalid) return { ok: false, reason: invalid };
  const label = input.recipientLabel.trim();
  const needsOptions = label !== "" || input.maxViews !== null;

  const { data, error } = needsOptions
    ? await supabase.rpc("create_record_share_with_options", {
        p_sections: [...input.sections],
        p_expires_in_hours: input.expiresInHours,
        p_use_pin: input.usePin,
        p_one_session: input.oneSession,
        p_recipient_label: label || undefined,
        p_max_views: input.maxViews ?? undefined,
      })
    : await supabase.rpc("create_record_share", {
        p_sections: [...input.sections],
        p_expires_in_hours: input.expiresInHours,
        p_use_pin: input.usePin,
        p_one_session: input.oneSession,
      });
  if (error) {
    if (needsOptions && missingFunction(error)) return { ok: false, reason: "options_unavailable" };
    return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  }
  const row = data as { id?: unknown; token?: unknown; pin?: unknown; expires_at?: unknown } | null;
  if (!row || typeof row.id !== "string" || typeof row.token !== "string" || typeof row.expires_at !== "string") return { ok: false, reason: "failed" };
  return { ok: true, share: { id: row.id, token: row.token, pin: typeof row.pin === "string" ? row.pin : null, expiresAt: row.expires_at } };
}

export async function revokeShare(shareId: string): Promise<{ ok: true } | { ok: false; reason: "offline" | "failed" }> {
  const { error } = await supabase.rpc("revoke_record_share", { p_share_id: shareId });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}

/** The link of a link the person already made, read only when they ask to send it again. Never stored. */
export async function fetchShareLink(shareId: string): Promise<{ ok: true; token: string } | { ok: false; reason: "offline" | "failed" }> {
  const { data, error } = await supabase.from("record_shares").select("token").eq("id", shareId).maybeSingle();
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  if (!data || typeof data.token !== "string") return { ok: false, reason: "failed" };
  return { ok: true, token: data.token };
}

export function shareFailureMessage(reason: ShareFailure | "revoke_failed"): string {
  if (reason === "offline") return t("mpass.needs_connection");
  const key = `mpass.share.err.${reason}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : t("mpass.save_failed");
}

export function sectionLabel(section: string): string {
  const key = `share.sections.${section}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : section.replace(/_/g, " ");
}
