import type { ReferralSource, ReferralUrgency, SpecialistType } from "@tarragon/shared";

export interface AppropriatenessFlag {
  code: string;
  message: string;
}

export interface AppropriatenessCheckInput {
  specialistType: SpecialistType | "";
  referralSource: ReferralSource;
  urgency: ReferralUrgency | null;
  referralReason: string;
  requestedService: string;
  recentInvestigationCount: number;
}

/**
 * CDS advisory checks for a referral before submission (67.7): missing
 * information, an origin that would normally carry urgency but doesn't yet,
 * and no recent investigations on file for a specialty where that's usually
 * expected before a specialist sees the patient.
 *
 * Deliberately advisory only, never blocking — "CDS can assist... but the
 * clinician remains accountable for the referral decision" (67.7). The
 * caller stores the returned flags on specialist_referrals.appropriateness_flags
 * as a submission-time audit trail; it never prevents the referral itself.
 */
export function checkReferralAppropriateness(input: AppropriatenessCheckInput): AppropriatenessFlag[] {
  const flags: AppropriatenessFlag[] = [];

  if (!input.specialistType) {
    flags.push({ code: "missing_specialist_type", message: "No specialist type selected." });
  }

  if (input.referralReason.trim().length === 0 && input.requestedService.trim().length === 0) {
    flags.push({
      code: "missing_clinical_question",
      message:
        'No reason or requested service given — avoid a bare "please see patient for further assessment."',
    });
  }

  if (input.urgency === null) {
    const urgentOrigins: ReferralSource[] = ["emergency_assessment", "abnormal_lab_result", "abnormal_imaging_result"];
    if (urgentOrigins.includes(input.referralSource)) {
      flags.push({
        code: "urgency_not_set_for_urgent_origin",
        message: "This referral's origin usually carries urgency, but none has been set.",
      });
    } else {
      flags.push({ code: "urgency_not_set", message: "No urgency has been set yet." });
    }
  }

  if (input.recentInvestigationCount === 0) {
    flags.push({
      code: "no_recent_investigations",
      message: "No recent investigations found on file for this patient before referring.",
    });
  }

  return flags;
}
