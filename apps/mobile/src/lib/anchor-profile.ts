import { buildAnchorProfile, type AnchorProfile, type AnchorTimeRow, type DayShiftRow } from "@tarragon/medicines";
import { loadDoseAnchorConfig } from "./anchor-config";
import { readLocalAnchorRows, readLocalShiftRows } from "./offline-store";
import { listOutbox, type AnchorTimesPayload, type DayShiftEndPayload, type DayShiftPayload } from "./outbox";
import { recordSyncError } from "./sync-diagnostics";

/**
 * The patient's anchor profile on the phone (S08z): their chosen anchor times and "my day has shifted" entries, read from the
 * mirror of what the server holds plus anything still waiting in the outbox, so a change made offline shows at once and is the
 * same list the server will hold. Held in memory per person so the synchronous schedule code (scheduleOf) can attach it.
 *
 * Until a person's profile has been read, or if it cannot be, the proposed defaults alone are used: an anchored dose still
 * resolves to a sensible time instead of vanishing, and the next read corrects it.
 */
export type { AnchorTimeRow, DayShiftRow };
export { buildAnchorProfile };

/** What the outbox still holds for a person, as rows in the same shape the server returns. */
export function pendingToRows(
  items: readonly { kind: string; clientId: string; createdAt: string; payload: unknown }[]
): { times: AnchorTimeRow[]; shifts: DayShiftRow[]; ends: Map<string, string> } {
  const times: AnchorTimeRow[] = [];
  const shifts: DayShiftRow[] = [];
  const ends = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "anchor_times") {
      const p = item.payload as AnchorTimesPayload;
      for (const [anchor, local_time] of Object.entries(p.times)) times.push({ anchor, effective_from: p.effective_from, local_time });
    } else if (item.kind === "day_shift") {
      const p = item.payload as DayShiftPayload;
      shifts.push({ id: item.clientId, starts_on: p.starts_on, ends_on: p.ends_on, offsets: p.offsets, cancelled_from: null, created_at: item.createdAt });
    } else if (item.kind === "day_shift_end") {
      const p = item.payload as DayShiftEndPayload;
      ends.set(p.shift_id, p.cancelled_from);
    }
  }
  return { times, shifts, ends };
}

/** Merges the server's rows with what is still waiting to be sent. The same anchor and date: the waiting one (newer) wins. */
export function mergeRows(
  serverTimes: readonly AnchorTimeRow[],
  serverShifts: readonly DayShiftRow[],
  pending: ReturnType<typeof pendingToRows>
): { times: AnchorTimeRow[]; shifts: DayShiftRow[] } {
  const byKey = new Map<string, AnchorTimeRow>();
  for (const r of [...serverTimes, ...pending.times]) byKey.set(`${r.anchor}|${r.effective_from}`, r);
  const shifts = [...serverShifts, ...pending.shifts].map((s) => {
    const end = pending.ends.get(s.id);
    return end === undefined ? s : { ...s, cancelled_from: s.cancelled_from === null ? end : s.cancelled_from < end ? s.cancelled_from : end };
  });
  return { times: [...byKey.values()], shifts };
}

const profiles = new Map<string, AnchorProfile>();

export function defaultsOnlyProfile(): AnchorProfile {
  return { defaults: loadDoseAnchorConfig().defaults, times: {}, shifts: [] };
}

/** The profile to resolve a person's anchored doses against. Always returns one: the defaults alone when none has been read. */
export function anchorProfileFor(subjectId: string | null | undefined): AnchorProfile {
  return (subjectId ? profiles.get(subjectId) : undefined) ?? defaultsOnlyProfile();
}

export function setAnchorProfile(subjectId: string, profile: AnchorProfile): void {
  profiles.set(subjectId, profile);
}

/** Test seam. */
export function __resetAnchorProfilesForTests(): void {
  profiles.clear();
}

/**
 * Reads a person's anchors and shifts (the mirror plus the outbox) into memory and returns the profile. Never throws: a failed
 * read keeps whatever was there before, or the defaults.
 */
export async function refreshAnchorProfile(subjectId: string): Promise<AnchorProfile> {
  try {
    const [timeRows, shiftRows, pendingItems] = await Promise.all([
      readLocalAnchorRows<AnchorTimeRow>(subjectId),
      readLocalShiftRows<DayShiftRow>(subjectId),
      listOutbox(),
    ]);
    const mine = pendingItems.filter((i) => i.subjectId === subjectId && (i.kind === "anchor_times" || i.kind === "day_shift" || i.kind === "day_shift_end"));
    const merged = mergeRows(timeRows, shiftRows, pendingToRows(mine));
    const profile = buildAnchorProfile(loadDoseAnchorConfig().defaults, merged.times, merged.shifts);
    profiles.set(subjectId, profile);
    return profile;
  } catch (error) {
    recordSyncError("offline_outbox", "anchorProfile:refresh", error);
    return anchorProfileFor(subjectId);
  }
}
