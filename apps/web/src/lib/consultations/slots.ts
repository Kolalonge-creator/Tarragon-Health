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
    }));
}
