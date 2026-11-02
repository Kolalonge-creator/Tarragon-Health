/**
 * Patient pages that sit behind a go-live guard (docs gate model G-01). A page whose guard is off must not appear in the menu, in search
 * or on a hub: it would only land the person on a "not open yet" notice. The page itself keeps that notice for anyone who reaches the
 * address directly. Web and phone read this one list, so the two surfaces hide the same things.
 *
 * Each `guard` is the key the page ALREADY checks through `go_live_guard_is_open`; nothing here is a new switch and nothing here turns
 * one on. Safety pages (emergency card, messages, the care team, vitals, medicines) are never listed, and `isGateHidden` is the only
 * place that decides, so a lookup that failed can only ever hide a page that is in this list.
 */
export type PatientGateId = "appointments" | "membership" | "recordsRequests" | "diary" | "resultPassport" | "contraception";

export interface PatientPageGate {
  id: PatientGateId;
  /** The go-live guard the page itself consults (`go_live_guard_is_open`). */
  guard: string;
  /** Web addresses that lead to the page. */
  webHrefs: readonly string[];
  /** The phone menu section that leads to the page, when there is one. */
  mobileSection: string | null;
  /**
   * True when the person can already hold something on the page (a booked visit, a Membership, a records request). Such a page stays
   * in the menu while the guard is off, so what they already have never vanishes, and also when we could not tell whether they hold anything.
   */
  holdable: boolean;
}

export const PATIENT_PAGE_GATES: readonly PatientPageGate[] = [
  { id: "appointments", guard: "clinical_operations_enabled", webHrefs: ["/patient/appointments"], mobileSection: "appointments", holdable: true },
  { id: "membership", guard: "membership_billing_enabled", webHrefs: ["/patient/membership"], mobileSection: null, holdable: true },
  { id: "recordsRequests", guard: "records_request_letters", webHrefs: ["/patient/records-requests"], mobileSection: "recordsRequests", holdable: true },
  { id: "diary", guard: "paper_diary_entry", webHrefs: ["/patient/diary"], mobileSection: null, holdable: false },
  { id: "resultPassport", guard: "result_passport_enabled", webHrefs: ["/patient/result-passport"], mobileSection: null, holdable: false },
  { id: "contraception", guard: "reproductive_content_enabled", webHrefs: ["/patient/contraception"], mobileSection: null, holdable: false },
];

/** What was learned about one gate. `null` means the lookup failed or has not answered. */
export interface PatientGateAnswer {
  guardOpen: boolean | null;
  holds: boolean | null;
}

export type PatientGateAnswers = Partial<Record<PatientGateId, PatientGateAnswer>>;

/**
 * Hidden when the guard is not known to be open. A guard that could not be read counts as closed (the page is not promised).
 * The one exception is a holdable page: it stays unless we positively know the person holds nothing there.
 */
export function isGateHidden(gate: PatientPageGate, answer: PatientGateAnswer): boolean {
  if (answer.guardOpen === true) return false;
  // A holdable page (care access) is never hidden on a failed read: only a guard positively known to be off, for someone known to hold nothing.
  if (gate.holdable && (answer.guardOpen === null || answer.holds !== false)) return false;
  return true;
}

function hiddenGates(answers: PatientGateAnswers): PatientPageGate[] {
  return PATIENT_PAGE_GATES.filter((g) => {
    const a = answers[g.id];
    return a !== undefined && isGateHidden(g, a);
  });
}

export function hiddenWebHrefs(answers: PatientGateAnswers): Set<string> {
  return new Set(hiddenGates(answers).flatMap((g) => [...g.webHrefs]));
}

export function hiddenMobileSections(answers: PatientGateAnswers): string[] {
  return hiddenGates(answers).flatMap((g) => (g.mobileSection ? [g.mobileSection] : []));
}

/** Pages that are never hidden whatever any lookup says: emergency, red-flag and care-team contact. A test keeps the list above clear of these. */
export const NEVER_HIDDEN_WEB_HREFS: readonly string[] = [
  "/patient",
  "/patient/emergency-card",
  "/patient/messages",
  "/patient/vitals",
  "/patient/medications",
  "/patient/care",
  "/patient/support",
  "/patient/actions",
];
export const NEVER_HIDDEN_MOBILE_SECTIONS: readonly string[] = ["overview", "emergency", "messages", "vitals", "medications", "care", "technicalSupport", "myActions"];
