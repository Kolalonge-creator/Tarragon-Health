/**
 * Two-tier model, item 3: the Member's monthly check-in on the phone. Pure model (no network, no React), proved in Jest.
 * The shapes mirror public.my_followups() and public.pick_followup_slot(). A changed server answer reads as an error, never as
 * "no times waiting". NOT run on a real phone: no EAS dev-client build exists for this app yet.
 */
import { formatWhen } from "./consultation-room-model";

export interface FollowupSlot {
  slot_id: string;
  starts_at: string;
  ends_at: string;
}

export interface FollowupOffer {
  offer_id: string;
  expires_at: string;
  call_minutes: number;
  kind: "monthly" | "yearly_results";
  longer_requested: boolean;
  slots: FollowupSlot[];
}

export interface FollowupCurrent {
  month_index: number;
  state: string;
  period_end: string;
  appointment_id: string | null;
  encounter_id: string | null;
}

export interface Followups {
  entitlement: { current: FollowupCurrent | null; consumed: number; lapsed: number; remaining: number } | null;
  offers: FollowupOffer[];
}

export type PickOutcome =
  | { kind: "booked"; startsAt: string }
  | { kind: "unavailable" }
  | { kind: "expired" }
  | { kind: "failed" };

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseSlot(raw: unknown): FollowupSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (!isString(s["slot_id"]) || !isString(s["starts_at"]) || !isString(s["ends_at"])) return null;
  return { slot_id: s["slot_id"], starts_at: s["starts_at"], ends_at: s["ends_at"] };
}

function parseOffer(raw: unknown): FollowupOffer | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isString(o["offer_id"]) || !isString(o["expires_at"]) || !isNumber(o["call_minutes"]) || !Array.isArray(o["slots"])) return null;
  if (o["kind"] !== "monthly" && o["kind"] !== "yearly_results") return null;
  const slots: FollowupSlot[] = [];
  for (const item of o["slots"]) {
    const slot = parseSlot(item);
    if (!slot) return null;
    slots.push(slot);
  }
  return {
    offer_id: o["offer_id"],
    expires_at: o["expires_at"],
    call_minutes: o["call_minutes"],
    kind: o["kind"],
    longer_requested: o["longer_requested"] === true,
    slots,
  };
}

export function parseFollowups(raw: unknown): Followups | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["offers"])) return null;
  const offers: FollowupOffer[] = [];
  for (const item of r["offers"]) {
    const offer = parseOffer(item);
    if (!offer) return null;
    offers.push(offer);
  }
  const e = r["entitlement"];
  if (e === null || e === undefined) return { entitlement: null, offers };
  if (typeof e !== "object") return null;
  const ent = e as Record<string, unknown>;
  if (!isNumber(ent["consumed"]) || !isNumber(ent["lapsed"]) || !isNumber(ent["remaining"])) return null;
  let current: FollowupCurrent | null = null;
  const c = ent["current"];
  if (c && typeof c === "object") {
    const cur = c as Record<string, unknown>;
    if (!isNumber(cur["month_index"]) || !isString(cur["state"]) || !isString(cur["period_end"])) return null;
    current = {
      month_index: cur["month_index"],
      state: cur["state"],
      period_end: cur["period_end"],
      appointment_id: isString(cur["appointment_id"]) ? cur["appointment_id"] : null,
      encounter_id: isString(cur["encounter_id"]) ? cur["encounter_id"] : null,
    };
  }
  return { entitlement: { current, consumed: ent["consumed"], lapsed: ent["lapsed"], remaining: ent["remaining"] }, offers };
}

/** Only a Member sees the card: someone with no months, no done check-ins and no offers sees nothing at all. */
export function isFollowupMember(f: Followups): boolean {
  const e = f.entitlement;
  return e !== null && (e.current !== null || e.remaining > 0 || e.consumed > 0 || f.offers.length > 0);
}

/** The times still ahead, soonest first. */
export function openSlots(offer: FollowupOffer, now: number): FollowupSlot[] {
  return offer.slots.filter((s) => Date.parse(s.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export function parsePick(raw: unknown): PickOutcome {
  if (!raw || typeof raw !== "object") return { kind: "failed" };
  const r = raw as Record<string, unknown>;
  switch (r["status"]) {
    case "booked":
      return isString(r["starts_at"]) ? { kind: "booked", startsAt: r["starts_at"] } : { kind: "failed" };
    case "unavailable":
      return { kind: "unavailable" };
    case "expired":
    case "withdrawn":
      return { kind: "expired" };
    default:
      return { kind: "failed" };
  }
}

export function slotLabel(slot: FollowupSlot): string {
  return formatWhen(slot.starts_at);
}
