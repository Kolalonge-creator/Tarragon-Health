import { getProposedConfig } from "@tarragon/shared";
import { PLATFORM_URL } from "./platform-url";
import { supabase } from "./supabase";

/**
 * Time-limited record share links on the phone (S09 + share extras). The phone only asks the database to make, list and revoke the link; the
 * PIN, the lockout, the view cap, the date window and the access log are all enforced by the same functions the web uses. Nothing here stores
 * a PIN: it is shown once, from the create call, and leaves screen state when the person says they are done.
 */
export type RecordShareSection = "vitals" | "medications" | "conditions" | "allergies" | "lab_results" | "vaccinations" | "emergency_info";

export const SHARE_SECTIONS: { id: RecordShareSection; label: string }[] = [
  { id: "vitals", label: "Readings" },
  { id: "medications", label: "Medicines" },
  { id: "conditions", label: "Conditions" },
  { id: "allergies", label: "Allergies" },
  { id: "lab_results", label: "Lab results" },
  { id: "vaccinations", label: "Vaccinations" },
  { id: "emergency_info", label: "Emergency information" },
];

/** Same choices as the web card; they sit inside the database limits (1..50 views; 30, 90 or 180 days). */
export const SHARE_MAX_VIEWS_CHOICES = [1, 3, 5, 10] as const;
export const SHARE_WINDOW_DAYS_CHOICES = [30, 90, 180] as const;

export interface SharingOffer {
  defaultExpiryHours: number;
  expiryOptionsHours: readonly number[];
  pinDigits: number;
}

export function getSharingOffer(): SharingOffer {
  const v = (getProposedConfig("my_health.sharing_and_access_log").value as unknown as {
    sharing: { default_expiry_hours: number; expiry_options_hours: number[]; pin_digits: number };
  }).sharing;
  return { defaultExpiryHours: v.default_expiry_hours, expiryOptionsHours: v.expiry_options_hours, pinDigits: v.pin_digits };
}

export function expiryText(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "1 day" : `${days} days`;
  }
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export interface RecordShareRow {
  id: string;
  token: string;
  sections: string[];
  expiresAt: string;
  isActive: boolean;
  viewCount: number;
  pinProtected: boolean;
  oneSession: boolean;
  lockedAt: string | null;
  revokedAt: string | null;
  recipientLabel: string | null;
  maxViews: number | null;
  windowDays: number | null;
}

export interface CreatedShare {
  id: string;
  token: string;
  pin: string | null;
}

export type ShareResult<T> = { ok: true; data: T } | { ok: false };

/** How many openings a capped link has left; null when it has no cap. Never negative. */
export function viewsLeft(maxViews: number | null, viewCount: number): number | null {
  return maxViews === null ? null : Math.max(maxViews - viewCount, 0);
}

export function shareUrl(token: string): string {
  return `${PLATFORM_URL}/share/${token}`;
}

/** Links that can still be opened: not revoked, not locked, not expired. */
export function openShares(rows: readonly RecordShareRow[], now: number = Date.now()): RecordShareRow[] {
  return rows.filter((r) => r.isActive && !r.revokedAt && !r.lockedAt && new Date(r.expiresAt).getTime() > now);
}

export async function loadMyShares(patientId: string): Promise<ShareResult<RecordShareRow[]>> {
  const { data, error } = await supabase
    .from("record_shares")
    .select("id, token, sections, expires_at, is_active, view_count, pin_protected, one_session, locked_at, revoked_at, recipient_label, max_views, window_days, created_at")
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error || !Array.isArray(data)) return { ok: false };
  return {
    ok: true,
    data: data.map((r) => ({
      id: r.id,
      token: r.token,
      sections: r.sections ?? [],
      expiresAt: r.expires_at,
      isActive: r.is_active,
      viewCount: r.view_count,
      pinProtected: Boolean(r.pin_protected),
      oneSession: Boolean(r.one_session),
      lockedAt: r.locked_at ?? null,
      revokedAt: r.revoked_at ?? null,
      recipientLabel: r.recipient_label ?? null,
      maxViews: r.max_views ?? null,
      windowDays: r.window_days ?? null,
    })),
  };
}

export interface CreateShareInput {
  sections: RecordShareSection[];
  expiresInHours: number;
  usePin: boolean;
  oneSession: boolean;
  recipientLabel: string;
  maxViews: number | null;
  windowDays: number | null;
}

export async function createShare(input: CreateShareInput): Promise<ShareResult<CreatedShare>> {
  const label = input.recipientLabel.trim();
  const { data, error } = await supabase.rpc("create_record_share_with_options", {
    p_sections: input.sections,
    p_expires_in_hours: input.expiresInHours,
    p_use_pin: input.usePin,
    p_one_session: input.oneSession,
    p_recipient_label: label ? label.slice(0, 80) : null,
    p_max_views: input.maxViews,
    p_window_days: input.windowDays,
  });
  const body = data as { id?: unknown; token?: unknown; pin?: unknown } | null;
  if (error || !body || typeof body.id !== "string" || typeof body.token !== "string") return { ok: false };
  return { ok: true, data: { id: body.id, token: body.token, pin: typeof body.pin === "string" ? body.pin : null } };
}

export async function revokeShare(shareId: string): Promise<ShareResult<null>> {
  const { error } = await supabase.rpc("revoke_record_share", { p_share_id: shareId });
  // Already stopped (on the web, or by a second tap) is the outcome the person asked for.
  if (error && !/already revoked/i.test(error.message ?? "")) return { ok: false };
  return { ok: true, data: null };
}

/** A listed link that has no views left. It still shows (so it can be stopped) but cannot be sent again: a clinic would be given a link that no longer opens. */
export function isUsedUp(share: Pick<RecordShareRow, "maxViews" | "viewCount">): boolean {
  return viewsLeft(share.maxViews, share.viewCount) === 0;
}

type FetchLike = (url: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export type ShlResult = { kind: "ok"; link: string } | { kind: "unavailable" } | { kind: "network" };

/** The hospital-system (SMART Health Link) string for one of the person's own links. Identity is the bearer token; the server reads the share as that person. */
export async function fetchShl(token: string | null, shareId: string, fetchImpl: FetchLike, baseUrl: string): Promise<ShlResult> {
  if (!token) return { kind: "unavailable" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchImpl(`${baseUrl}/api/mobile/share-shl?id=${encodeURIComponent(shareId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => null)) as { link?: unknown } | null;
    if (res.status === 200 && body && typeof body.link === "string" && body.link.startsWith("shlink:/")) return { kind: "ok", link: body.link };
    return { kind: "unavailable" };
  } catch {
    return { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}
