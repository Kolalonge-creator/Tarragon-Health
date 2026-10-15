/**
 * Entitlements for the person (S72, function 19.12): what they have paid for, been given by a supporter, had covered by a sponsor, or received from the
 * Community Access Fund. The database function public.my_entitlements decides every field; this file only checks the SHAPE and chooses the plain words
 * (as i18n KEYS, never English text), so web and mobile say the same thing: "3 consultations remaining", "valid for 60 more days".
 * Nothing here is a balance (INV-09): an entitlement is a thing the person may use, with a count and an end, and it is never money.
 */
export type EntitlementSource = "paid" | "supporter" | "sponsor" | "access_fund";
const SOURCES: readonly EntitlementSource[] = ["paid", "supporter", "sponsor", "access_fund"];

export interface EntitlementView {
  readonly id: string;
  readonly kind: string;
  readonly state: "active" | "expired" | "used" | "revoked";
  readonly nameKey: string;
  readonly endsAt: string | null;
  readonly remainingUses: number | null;
  /** Whole days left, rounded up; null when there is no end date or the entitlement is not active. */
  readonly daysLeft: number | null;
  readonly source: EntitlementSource;
  /** The sponsor's name, only for a sponsor source ("Covered by ..."). Never set for the Community Access Fund. */
  readonly sponsorName: string | null;
  readonly partCovered: boolean;
}

const STATES = ["active", "expired", "used", "revoked"] as const;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** Anything that is not a well-formed list yields an empty list: the screen then says "nothing here", never a wrong claim. */
export function parseEntitlements(raw: unknown): EntitlementView[] {
  if (!Array.isArray(raw)) return [];
  const out: EntitlementView[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const x = r as Record<string, unknown>;
    const state = x["state"];
    if (typeof x["id"] !== "string" || typeof x["kind"] !== "string" || typeof x["name_key"] !== "string" || !STATES.includes(state as (typeof STATES)[number])) continue;
    const src = SOURCES.includes(x["source"] as EntitlementSource) ? (x["source"] as EntitlementSource) : "paid";
    out.push({
      id: x["id"], kind: x["kind"], state: state as EntitlementView["state"], nameKey: x["name_key"],
      endsAt: typeof x["ends_at"] === "string" ? x["ends_at"] : null,
      remainingUses: isInt(x["remaining_uses"]) && x["remaining_uses"] >= 0 ? x["remaining_uses"] : null,
      daysLeft: isInt(x["days_left"]) && x["days_left"] >= 0 ? x["days_left"] : null,
      source: src, sponsorName: typeof x["sponsor_name"] === "string" && src === "sponsor" ? x["sponsor_name"] : null,
      partCovered: x["part_covered"] === true,
    });
  }
  return out;
}

export interface WordingLine {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** Singular and plural keys per kind. A kind without its own noun uses the general "uses left" wording. */
const REMAINING_KEYS: Readonly<Record<string, readonly [string, string]>> = {
  consultation_credit: ["entitlement.remaining.consultation_one", "entitlement.remaining.consultation_other"],
  lab_panel: ["entitlement.remaining.lab_panel_one", "entitlement.remaining.lab_panel_other"],
  care_pack: ["entitlement.remaining.care_pack_one", "entitlement.remaining.care_pack_other"],
};

/** The plain lines under an entitlement's name, in the order they should be read. Expired, used and revoked entitlements say only their state. */
export function entitlementLines(e: EntitlementView): WordingLine[] {
  const lines: WordingLine[] = [];
  if (e.state !== "active") {
    lines.push({ key: `entitlement.state.${e.state}`, params: {} });
    return lines;
  }
  if (e.remainingUses !== null) {
    const k = REMAINING_KEYS[e.kind];
    if (k) lines.push({ key: e.remainingUses === 1 ? k[0] : k[1], params: { count: e.remainingUses } });
    else lines.push({ key: e.remainingUses === 1 ? "entitlement.remaining_uses" : "entitlement.remaining_uses_plural", params: { count: e.remainingUses } });
  }
  if (e.daysLeft !== null) {
    if (e.daysLeft === 0) lines.push({ key: "entitlement.valid_today", params: {} });
    else lines.push({ key: e.daysLeft === 1 ? "entitlement.valid_days_one" : "entitlement.valid_days_other", params: { count: e.daysLeft } });
  }
  return lines;
}

/** Where it came from, in the person's own words. A part-covered order says so; the Fund is never described beyond its name. */
export function entitlementSource(e: EntitlementView): WordingLine {
  switch (e.source) {
    case "access_fund":
      return { key: "entitlement.source.access_fund", params: {} };
    case "sponsor":
      return e.sponsorName ? { key: "entitlement.source.sponsor", params: { name: e.sponsorName } } : { key: "entitlement.source.sponsor_generic", params: {} };
    case "supporter":
      return { key: "entitlement.source.supporter", params: {} };
    default:
      return { key: "entitlement.source.paid", params: {} };
  }
}
