import type { MaternalConfig } from "./config";

/**
 * Antenatal contact schedule (spec 16.5, CMO selection A5). One planned contact per configured week. A reminder date is a
 * guide: the care team may ask for an earlier visit when a risk flag or an amber pregnancy reading exists. That is a decision
 * for a person (see `antenatalReviewReasons`), never a silent change of this schedule.
 */
export interface PlannedContact {
  /** 1-based number of the contact in the configured list. */
  readonly visitNumber: number;
  /** The gestational week this contact is planned for (the first contact is "by" this week). */
  readonly targetWeek: number;
  /** True for the first contact when it is late: she registered after the planned week and should book as soon as she can. */
  readonly dueNow: boolean;
}

/**
 * Contacts still ahead on `currentWeek`. Contacts before the current week are dropped (they are not marked missed: she may
 * simply have registered late). When the first contact has passed, the earliest remaining planned contact is not delayed; the
 * first one is offered as due now so a late booking never loses its first visit.
 */
export function plannedContacts(currentWeek: number, config: MaternalConfig): PlannedContact[] {
  const weeks = config.antenatal.contactWeeks;
  const out: PlannedContact[] = [];
  weeks.forEach((targetWeek, index) => {
    if (targetWeek >= currentWeek) out.push({ visitNumber: index + 1, targetWeek, dueNow: false });
  });
  const first = weeks[0];
  if (first !== undefined && currentWeek > first) {
    out.unshift({ visitNumber: 1, targetWeek: currentWeek, dueNow: true });
  }
  return out;
}

export interface ReviewSignals {
  readonly riskFlags: readonly string[];
  /** An amber pregnancy blood pressure result in the last 14 days (BP-P1 raised or above). */
  readonly amberPregnancyBp: boolean;
}

/** Reasons a clinician should be prompted to consider an earlier contact. Empty means no prompt. */
export function antenatalReviewReasons(signals: ReviewSignals): string[] {
  const reasons: string[] = [];
  if (signals.riskFlags.length > 0) reasons.push("risk_flag");
  if (signals.amberPregnancyBp) reasons.push("amber_blood_pressure");
  return reasons;
}
