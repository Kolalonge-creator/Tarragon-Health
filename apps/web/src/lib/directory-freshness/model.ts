import { z } from "zod";

/**
 * S36g: directory freshness (spec 25.3, 25.9). The database computes every status and date; this only parses the answer and
 * groups it for the screen. Nothing here hides or switches off a listing: a past-due listing shows "verification overdue" and a
 * person decides what to do about it.
 */
export const LISTING_TABLES = [
  "lab_providers",
  "pharmacy_partners",
  "specialist_providers",
  "facilities",
  "home_visit_providers",
  "logistics_partners",
] as const;
export type ListingTable = (typeof LISTING_TABLES)[number];

export const STATUSES = ["overdue", "due_soon", "never_verified", "current"] as const;
export type FreshnessStatus = (typeof STATUSES)[number];

export const freshnessRowSchema = z.object({
  listing_table: z.enum(LISTING_TABLES),
  listing_id: z.string().uuid(),
  name: z.string(),
  is_active: z.boolean(),
  last_verified_at: z.string().nullable(),
  verified_by_name: z.string().nullable(),
  next_verification_due: z.string().nullable(),
  status: z.enum(STATUSES),
  days_overdue: z.number().int().nullable(),
  can_record: z.boolean(),
});
export type FreshnessRow = z.infer<typeof freshnessRowSchema>;
export const freshnessRowsSchema = z.array(freshnessRowSchema);

export interface FreshnessGroups {
  overdue: FreshnessRow[];
  dueSoon: FreshnessRow[];
  neverVerified: FreshnessRow[];
  currentCount: number;
}

/** Groups the rows for the three lists on the screen. Active listings only reach here; the order is the database's order. */
export function groupFreshness(rows: readonly FreshnessRow[]): FreshnessGroups {
  return {
    overdue: rows.filter((r) => r.status === "overdue"),
    dueSoon: rows.filter((r) => r.status === "due_soon"),
    neverVerified: rows.filter((r) => r.status === "never_verified"),
    currentCount: rows.filter((r) => r.status === "current").length,
  };
}

/** Notices carried in the address are fixed tokens, so a link can never put its own words on the page. */
export const NOTICES = ["recorded", "record_failed", "record_denied", "note_short"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

export const recordFormSchema = z.object({
  listing_table: z.enum(LISTING_TABLES),
  listing_id: z.string().uuid(),
  note: z.string().trim().min(10).max(500),
});

/** `lab_providers` becomes "Laboratory" and so on, for the kind column. */
export const KIND_LABEL: Record<ListingTable, string> = {
  lab_providers: "Laboratory",
  pharmacy_partners: "Pharmacy",
  specialist_providers: "Specialist",
  facilities: "Facility",
  home_visit_providers: "Home visit provider",
  logistics_partners: "Delivery partner",
};
