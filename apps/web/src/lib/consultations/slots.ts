/**
 * S21 (OQ-124): the open consultation slots come from time clinicians have declared and the rota has confirmed
 * (list_bookable_consult_slots), not from the older weekly-rules engine. This maps that function's rows onto the slot shape the
 * booking list already renders, and drops anything malformed rather than showing a slot that cannot be held.
 */
export interface BookableConsultSlotRow {
  clinician_id: string;
  clinician_name: string | null;
  specialty: string | null;
  languages: string[] | null;
  /** S64: what the person is booked as. Absent on rows from before S64. */
  care_role?: "doctor" | "dietitian" | "pharmacist" | null;
  sex?: string | null;
  /** S64 (Q19): shown only when a credential check is on record; null otherwise. */
  mdcn_number?: string | null;
  licence_checked_on?: string | null;
  licence_current: boolean;
  licence_verified_at: string | null;
  slot_start: string;
  slot_end: string;
}

export interface ConsultSlot {
  clinician_id: string;
  clinician_name: string;
  slot_start: string;
  slot_end: string;
  consultation_method: "telemedicine";
  location: null;
  specialty: string | null;
  languages: string[];
  sex: string | null;
  /** Null-gated: the number and its checked-on date are both present or both null. */
  mdcn_number: string | null;
  licence_checked_on: string | null;
}

const valid = (r: BookableConsultSlotRow): boolean =>
  typeof r.clinician_id === "string" && Number.isFinite(Date.parse(r.slot_start)) && Number.isFinite(Date.parse(r.slot_end)) && Date.parse(r.slot_end) > Date.parse(r.slot_start);

export function toConsultSlots(rows: readonly BookableConsultSlotRow[] | null | undefined): ConsultSlot[] {
  return (rows ?? [])
    .filter(valid)
    // A clinician whose licence is not current is never offered: the database already refuses to list one, this is the second lock.
    .filter((r) => r.licence_current)
    .map((r) => ({
      clinician_id: r.clinician_id,
      clinician_name: r.clinician_name?.trim() || "Care team",
      slot_start: r.slot_start,
      slot_end: r.slot_end,
      consultation_method: "telemedicine" as const,
      location: null,
      specialty: r.specialty?.trim() || null,
      languages: (r.languages ?? []).filter((l) => typeof l === "string" && l.length > 0),
      sex: r.sex ?? null,
      // the number is never shown without the date it was checked, and never when no check is on record
      mdcn_number: r.mdcn_number && r.licence_checked_on && Number.isFinite(Date.parse(r.licence_checked_on)) ? r.mdcn_number : null,
      licence_checked_on: r.mdcn_number && r.licence_checked_on && Number.isFinite(Date.parse(r.licence_checked_on)) ? r.licence_checked_on : null,
    }));
}

/** S64 (15.1): what the patient has picked to narrow the list. Empty string means "any". Price is shown, never filtered (one price). */
export interface SlotFilters {
  specialty: string;
  language: string;
  sex: string;
}

export const NO_SLOT_FILTERS: SlotFilters = { specialty: "", language: "", sex: "" };

export function filterConsultSlots(slots: readonly ConsultSlot[], f: SlotFilters): ConsultSlot[] {
  return slots.filter(
    (s) =>
      (!f.specialty || (s.specialty ?? "").toLowerCase() === f.specialty.toLowerCase()) &&
      (!f.language || s.languages.some((l) => l.toLowerCase() === f.language.toLowerCase())) &&
      (!f.sex || (s.sex ?? "").toLowerCase() === f.sex.toLowerCase()),
  );
}

/** The choices on offer are only ones that exist in the open slots, so a filter can never be picked that matches nothing. */
export function slotFilterOptions(slots: readonly ConsultSlot[]): { specialties: string[]; languages: string[]; sexes: string[] } {
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
  return {
    specialties: uniq(slots.map((s) => s.specialty).filter((x): x is string => !!x)),
    languages: uniq(slots.flatMap((s) => s.languages)),
    sexes: uniq(slots.map((s) => s.sex).filter((x): x is string => !!x)),
  };
}
