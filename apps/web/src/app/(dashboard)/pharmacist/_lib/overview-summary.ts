import type { StatTileValueProps } from "@/components/ui/stat-tile-value";
import type { RefreshQueryState } from "@/lib/queries/list-query-state";
import type { PharmacistDispense, PharmacistProfile } from "@/lib/queries/pharmacist";
import { sliceState, sliceTile, unknownHint, type QuerySlice } from "@/lib/queries/query-slice";
import { isAwaitingStatus, isOpenStatus } from "./order-status";
import type { PharmacistOrderRow } from "./items";
import { isLagosToday } from "./format";

/**
 * What the pharmacist overview shows, worked out apart from the component so
 * the rules can be tested without rendering or a QueryClient.
 *
 * Why it exists. The overview used to read `data ?? []` for orders and for the
 * dispensing history and never looked at errors. A failed orders read
 * therefore showed "Orders awaiting 0" and "No orders waiting. You're caught
 * up." while patients' orders sat unseen, a failed history read showed
 * "Nothing dispensed yet today", and a failed profile read said "No pharmacy
 * profile on file yet". A pharmacist cannot tell any of those from a quiet
 * counter. Here a figure with no data is unknown, and "caught up" is only said
 * when the orders were actually read, are current, and there are none.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const SOON_DAYS = 60;

export interface PharmacistOverviewInputs {
  orders: QuerySlice<PharmacistOrderRow[]>;
  dispenses: QuerySlice<PharmacistDispense[]>;
  /** `null` data means the profile was read and there is none on file. */
  profile: QuerySlice<PharmacistProfile | null>;
}

export type LicenceTone = "ok" | "soon" | "expired";

export interface PharmacistOverview {
  orders: {
    state: RefreshQueryState;
    tiles: { awaiting: StatTileValueProps; inProgress: StatTileValueProps; open: StatTileValueProps };
    /** The first few open orders, from the last good read. */
    snapshot: PharmacistOrderRow[];
    /** True only when the orders were read, are current, and none are open. */
    caughtUp: boolean;
  };
  dispenses: {
    state: RefreshQueryState;
    tile: StatTileValueProps;
    today: PharmacistDispense[];
    /** True only when the history was read, is current, and nothing was dispensed today. */
    nothingYet: boolean;
  };
  profile: {
    state: RefreshQueryState;
    /** "none": read fine, no profile on file. "unknown": not read. */
    kind: "unknown" | "none" | "ready";
    regions: string;
    licence: string;
    expires: { text: string; tone: LicenceTone; note: string | null };
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The moment a licence stops being valid. A date-only expiry means valid
 * through that whole day in Lagos, so it runs to 23:59:59.999 Lagos time; a
 * full timestamp is used as it is. NaN when the value is not a date.
 */
function expiryMs(expiresAt: string): number {
  return DATE_ONLY.test(expiresAt)
    ? new Date(`${expiresAt}T23:59:59.999+01:00`).getTime()
    : new Date(expiresAt).getTime();
}

/** How near a licence expiry is. Expired is its own state: a past date is not "soon". */
export function licenceTone(expiresAt: string | null, now: Date = new Date()): LicenceTone {
  if (!expiresAt) return "ok";
  const ms = expiryMs(expiresAt);
  if (Number.isNaN(ms)) return "ok";
  if (ms < now.getTime()) return "expired";
  return Math.round((ms - now.getTime()) / DAY_MS) < SOON_DAYS ? "soon" : "ok";
}

/** The expiry as a date for display, or null if it is not a date at all. */
function formatExpiry(expiresAt: string): string | null {
  if (Number.isNaN(expiryMs(expiresAt))) return null;
  // A date-only value has no time zone of its own, so read it as the calendar
  // date it names and do not let the viewer's zone shift it by a day.
  return new Date(DATE_ONLY.test(expiresAt) ? `${expiresAt}T00:00:00.000Z` : expiresAt).toLocaleDateString(
    "en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: DATE_ONLY.test(expiresAt) ? "UTC" : "Africa/Lagos" }
  );
}

export function buildPharmacistOverview(
  inputs: PharmacistOverviewInputs,
  now: Date = new Date()
): PharmacistOverview {
  const { orders, dispenses, profile } = inputs;

  const ordersState = sliceState(orders);
  const dispensesState = sliceState(dispenses);
  const profileState = sliceState(profile);

  const open = (orders.data ?? []).filter((o) => isOpenStatus(o.status));
  const todays = (dispenses.data ?? []).filter((d) => isLagosToday(d.dispensed_on, now));

  const p = profile.data;
  let profileView: PharmacistOverview["profile"];
  if (p === undefined) {
    const text = unknownHint(profile);
    profileView = {
      state: profileState,
      kind: "unknown",
      regions: text,
      licence: text,
      expires: { text, tone: "ok", note: null },
    };
  } else if (p === null) {
    profileView = {
      state: profileState,
      kind: "none",
      regions: "Not recorded",
      licence: "Not recorded",
      expires: { text: "Not recorded", tone: "ok", note: null },
    };
  } else {
    const tone = licenceTone(p.license_expires_at, now);
    profileView = {
      state: profileState,
      kind: "ready",
      regions: p.regions.length > 0 ? p.regions.join(", ") : "None set",
      licence: p.license_number ?? "Not recorded",
      expires: {
        text: p.license_expires_at
          ? (formatExpiry(p.license_expires_at) ?? "Not a valid date")
          : "Not recorded",
        tone,
        note: tone === "expired" ? "Expired" : tone === "soon" ? "Expires soon" : null,
      },
    };
  }

  return {
    orders: {
      state: ordersState,
      tiles: {
        awaiting: sliceTile(orders, (rows) => rows.filter((o) => isAwaitingStatus(o.status)).length),
        inProgress: sliceTile(orders, (rows) => rows.filter((o) => o.status === "confirmed").length),
        open: sliceTile(orders, (rows) => rows.filter((o) => isOpenStatus(o.status)).length),
      },
      snapshot: open.slice(0, 3),
      caughtUp: ordersState === "ready" && open.length === 0,
    },
    dispenses: {
      state: dispensesState,
      tile: sliceTile(dispenses, () => todays.length),
      today: todays,
      nothingYet: dispensesState === "ready" && todays.length === 0,
    },
    profile: profileView,
  };
}
