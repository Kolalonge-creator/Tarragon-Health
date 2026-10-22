/**
 * Assisted entry of readings: a helper (a family member or other caregiver the person has allowed) types in a blood pressure or sugar reading
 * for the person. The database stores it as the person's reading with the helper's id on it (vitals_readings.logged_by_profile_id) and one row in
 * assisted_entry_log. These are the words and the small parsers the web and the phone share, so both say the same thing.
 *
 * The reading's source stays "manual" (or "device"); "assisted" is a fact about who entered it, not a new kind of measurement, so every
 * rule, trigger and report keyed on the existing sources keeps working.
 */

export type AssistedAudience = "patient" | "clinician" | "helper";
export type AssistedActorKind = "caregiver" | "pharmacy";

export interface AssistedAttribution {
  readingId: string;
  actorId: string;
  actorName: string | null;
  actorKind: AssistedActorKind;
}

const NAME_MAX = 60;

function cleanName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim();
  return n.length === 0 ? null : n.slice(0, NAME_MAX);
}

/** "Entered for you by Tunde", said from the point of view of whoever is looking. Never says "Typed by you" for a helper's entry. */
export function assistedEntryLabel(name: string | null | undefined, audience: AssistedAudience, kind: AssistedActorKind = "caregiver"): string {
  const n = cleanName(name);
  if (audience === "helper") return "Entered by you for them";
  if (audience === "clinician") {
    return n ? `Entered on the patient's behalf by ${n}` : "Entered on the patient's behalf by a helper";
  }
  if (kind === "pharmacy") return n ? `Entered for you by ${n} at the pharmacy` : "Entered for you at the pharmacy";
  return n ? `Entered for you by ${n}` : "Entered for you by someone who helps you";
}

/** The caption under a chart that includes helper-entered points. Null when there are none. */
export function assistedEntryCaption(assistedCount: number, total: number, overLimitCount = 0): string | null {
  if (!Number.isFinite(assistedCount) || assistedCount <= 0 || total <= 0) return null;
  const n = Math.min(assistedCount, total);
  const base = `${n} of ${total} readings here ${n === 1 ? "was" : "were"} entered by a helper on the person's behalf.`;
  const over = Math.min(Math.max(overLimitCount, 0), n);
  return over > 0 ? `${base} ${over} of them came in faster than the usual limit and were kept, not refused.` : base;
}

/** Parses the attribution RPC's answer. A malformed answer is an empty list, never a guessed name. */
export function parseAssistedAttribution(data: unknown): AssistedAttribution[] {
  if (!Array.isArray(data)) return [];
  const out: AssistedAttribution[] = [];
  for (const row of data as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.reading_id !== "string" || typeof r.actor_id !== "string") continue;
    out.push({
      readingId: r.reading_id,
      actorId: r.actor_id,
      actorName: typeof r.actor_name === "string" ? r.actor_name : null,
      actorKind: r.actor_kind === "pharmacy" ? "pharmacy" : "caregiver",
    });
  }
  return out;
}

export type AssistedRefusal = "not_permitted" | "rate_limited" | "source" | "too_old" | "unavailable";

/** Which assisted-entry refusal a database error is, from its code and text. Null means it is not one of ours. */
export function classifyAssistedRefusal(error: { code?: string | null; message?: string | null } | null | undefined): AssistedRefusal | null {
  const msg = error?.message ?? "";
  if (msg.includes("assisted_entry_rate_limited")) return "rate_limited";
  if (msg.includes("assisted_entry_unavailable")) return "unavailable";
  if (msg.includes("assisted_entry_source")) return "source";
  if (msg.includes("assisted_entry_time")) return "too_old";
  if (msg.includes("assisted_entry_not_permitted")) return "not_permitted";
  return null;
}

/** Plain words for a refusal. Never the database text. */
export function assistedRefusalMessage(kind: AssistedRefusal): string {
  switch (kind) {
    case "rate_limited":
      return "Too many readings have been entered for this person just now. Please wait a while and try again. If they feel unwell, get them to care first; they can also enter it themselves.";
    case "not_permitted":
      return "You have not been allowed to enter readings for this person. If it is urgent, get them to care first; they can allow it in the people who help them.";
    case "source":
      return "A reading entered for someone else has to be typed in or come from their paired device.";
    case "too_old":
      return "That reading is too old to enter for someone else. Please take it again.";
    case "unavailable":
      return "Entering readings for someone else is not available just now. Please try again later.";
  }
}
