/**
 * "My phones" (S06z): the patient's own list of phones that hold their Tarragon data offline. Pure and dependency light so the web page and
 * the phone app read a lease row exactly the same way.
 *
 * Privacy: the list is only ever the signed-in person's own rows (the table's select policy is `account_id = auth.uid()`); nothing here names
 * another person, and a supporter acting for someone else is shown nothing (the screens refuse before they ask).
 */
import { z } from "zod";

export const PHONE_NAME_MAX = 40;

/** The columns the screen reads from `offline_device_leases`. Unknown keys are ignored. */
export const phoneRowSchema = z.object({
  device_id: z.string().min(1),
  platform: z.string(),
  device_label: z.string().nullable().optional(),
  shared_phone: z.boolean().optional(),
  last_checkin_at: z.string(),
  lease_expires_at: z.string(),
  revoked_at: z.string().nullable().optional(),
  wipe_confirmed_at: z.string().nullable().optional(),
  unsent_at_wipe: z.number().nullable().optional(),
  danger_at_wipe: z.number().nullable().optional(),
  retired_at: z.string().nullable().optional(),
});
export type PhoneRow = z.infer<typeof phoneRowSchema>;

export type PhoneStatus = "active" | "lapsed" | "removal_pending" | "wiped";

export interface PhoneView {
  deviceId: string;
  name: string;
  /** True when the patient never named it, so the screen can offer "give it a name". */
  nameIsDefault: boolean;
  platform: "ios" | "android";
  shared: boolean;
  status: PhoneStatus;
  lastSeenAt: string;
  leaseExpiresAt: string;
  isThisPhone: boolean;
  /** Only for a wiped phone: counts the phone reported, never content. */
  unsentAtWipe: number | null;
  urgentAtWipe: number | null;
}

/** Rows that fail the shape are dropped, never guessed at. `dropped` lets the screen say so instead of showing a shorter list as if complete. */
export function parsePhoneRows(data: unknown): { rows: PhoneRow[]; dropped: number } {
  if (!Array.isArray(data)) return { rows: [], dropped: 0 };
  const rows: PhoneRow[] = [];
  let dropped = 0;
  for (const item of data) {
    const r = phoneRowSchema.safeParse(item);
    if (r.success) rows.push(r.data);
    else dropped += 1;
  }
  return { rows, dropped };
}

export function phoneStatus(row: PhoneRow, now: Date): PhoneStatus {
  if (row.wipe_confirmed_at) return "wiped";
  if (row.revoked_at) return "removal_pending";
  return Date.parse(row.lease_expires_at) < now.getTime() ? "lapsed" : "active";
}

/** What the patient sees when they have not named a phone. */
export function defaultPhoneName(platform: string): string {
  return platform === "ios" ? "iPhone" : "Android phone";
}

/**
 * Cleans a typed name the way the database will: control characters (C0, DEL and C1, the class Postgres refuses) become spaces, trimmed, at
 * most PHONE_NAME_MAX characters counted by code point so an emoji is never cut in half. Null means "no usable name".
 */
export function cleanPhoneName(input: string): string | null {
  const trimmed = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return Array.from(trimmed).slice(0, PHONE_NAME_MAX).join("").trim();
}

/** The columns both screens read, in one place so web and phone cannot drift. */
export const PHONE_COLUMNS =
  "device_id, platform, device_label, shared_phone, last_checkin_at, lease_expires_at, revoked_at, wipe_confirmed_at, unsent_at_wipe, danger_at_wipe, retired_at";

/** Arguments for `update_my_offline_device`: only what changed. `label: null` clears the name. */
export function phoneUpdateArgs(deviceId: string, change: { label?: string | null; shared?: boolean }): {
  p_device: string;
  p_label?: string;
  p_clear_label?: boolean;
  p_shared?: boolean;
} {
  return {
    p_device: deviceId,
    ...(change.label ? { p_label: change.label } : {}),
    ...(change.label === null ? { p_clear_label: true } : {}),
    ...(change.shared !== undefined ? { p_shared: change.shared } : {}),
  };
}

/**
 * Newest activity first, with a phone waiting to be cleared kept near the top (the patient asked for that one), wiped phones last.
 * `thisPhoneId` is known only on the phone app; the web page cannot tell which one the browser is on and passes null.
 */
export function buildPhoneViews(rows: readonly PhoneRow[], now: Date, thisPhoneId: string | null): PhoneView[] {
  const order: Record<PhoneStatus, number> = { removal_pending: 0, active: 1, lapsed: 2, wiped: 3 };
  return rows
    .filter((r) => !r.retired_at || r.revoked_at)
    .map((r): PhoneView => {
      const label = r.device_label?.trim();
      return {
        deviceId: r.device_id,
        name: label ? label : defaultPhoneName(r.platform),
        nameIsDefault: !label,
        platform: r.platform === "ios" ? "ios" : "android",
        shared: r.shared_phone === true,
        status: phoneStatus(r, now),
        lastSeenAt: r.last_checkin_at,
        leaseExpiresAt: r.lease_expires_at,
        isThisPhone: thisPhoneId !== null && r.device_id === thisPhoneId,
        unsentAtWipe: typeof r.unsent_at_wipe === "number" ? r.unsent_at_wipe : null,
        urgentAtWipe: typeof r.danger_at_wipe === "number" ? r.danger_at_wipe : null,
      };
    })
    .sort((a, b) => order[a.status] - order[b.status] || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}
